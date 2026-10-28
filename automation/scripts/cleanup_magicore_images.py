#!/usr/bin/env python3
"""Run an explicitly approved, resumable visible-source cleanup on a Docker host."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import threading
import urllib.error
import urllib.parse
import urllib.request


DOCKER_MANIFEST = 'application/vnd.docker.distribution.manifest.v2+json'
DOCKER_LAYER = 'application/vnd.docker.image.rootfs.diff.tar.gzip'
CONFIG_KEYS = ['Entrypoint', 'Cmd', 'Env', 'WorkingDir', 'User', 'Labels', 'Volumes',
               'ExposedPorts', 'Healthcheck', 'Shell', 'StopSignal', 'OnBuild']


def command(args, timeout=1800):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Command failed: ' + args[0] + ' ' + str(result.returncode)
                           + ' ' + result.stderr[-600:])
    return result.stdout.strip()


def inspect(ref):
    return json.loads(command(['docker', 'image', 'inspect', ref]))[0]


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def docker_manifest(manifest):
    result = json.loads(json.dumps(manifest))
    if result.get('schemaVersion') != 2 or 'layers' not in result:
        raise ValueError('Not a single-platform image manifest')
    result['mediaType'] = DOCKER_MANIFEST
    result['config']['mediaType'] = 'application/vnd.docker.container.image.v1+json'
    for layer in result['layers']:
        if layer['mediaType'] == 'application/vnd.oci.image.layer.v1.tar+gzip':
            layer['mediaType'] = DOCKER_LAYER
        if layer['mediaType'] != DOCKER_LAYER:
            raise ValueError('Unsupported layer format')
    return result


def verify_preview(original, preview):
    def normalized(config, key):
        value = config.get(key)
        if key in ['User', 'WorkingDir', 'StopSignal']:
            return value or ''
        if key in ['Entrypoint', 'Cmd', 'Env', 'Shell', 'OnBuild']:
            return value or []
        if key in ['Labels', 'Volumes', 'ExposedPorts']:
            return value or {}
        return value
    if any(normalized(original['Config'], k) != normalized(preview['Config'], k) for k in CONFIG_KEYS):
        raise ValueError('Runtime configuration changed')
    if preview['RootFS']['Layers'][:-1] != original['RootFS']['Layers']:
        raise ValueError('Original layers changed')
    if (original['Os'], original['Architecture']) != (preview['Os'], preview['Architecture']):
        raise ValueError('Platform changed')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Registry:
    def __init__(self, repository):
        self.host, self.repository = repository.split('/', 1)
        self.base = 'https://' + self.host
        self.path = '/v2/' + self.repository
        self.opener = urllib.request.build_opener(NoRedirect)
        try:
            self.opener.open(self.base + '/v2/', timeout=30)
        except urllib.error.HTTPError as exc:
            if exc.code != 401:
                raise
            challenge = exc.headers['WWW-Authenticate']
        else:
            raise RuntimeError('Expected authenticated registry')
        fields = dict(re.findall(r'(\w+)="([^"]*)"', challenge))
        realm = urllib.parse.urlsplit(fields['realm'])
        if realm.scheme != 'https' or realm.netloc != self.host:
            raise ValueError('Unexpected token service')
        config = json.loads((Path.home() / '.docker/config.json').read_text())
        auth = config['auths'][self.host]['auth']
        query = urllib.parse.urlencode({'service': fields['service'],
                                       'scope': 'repository:' + self.repository + ':pull,push'})
        request = urllib.request.Request(fields['realm'] + '?' + query,
                                         headers={'Authorization': 'Basic ' + auth})
        with self.opener.open(request, timeout=30) as response:
            tokens = json.load(response)
        self.token = tokens.get('token') or tokens['access_token']

    def request(self, path, method='GET', data=None, headers=None):
        url = urllib.parse.urljoin(self.base, path)
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'https' or parsed.netloc != self.host:
            raise ValueError('Refusing to forward registry credentials')
        request = urllib.request.Request(url, data=data, method=method,
                                         headers={'Authorization': 'Bearer ' + self.token, **(headers or {})})
        return self.opener.open(request, timeout=120)

    def manifest(self, tag):
        accept = DOCKER_MANIFEST + ', application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json'
        with self.request(self.path + '/manifests/' + tag, headers={'Accept': accept}) as response:
            data = response.read()
            digest = 'sha256:' + hashlib.sha256(data).hexdigest()
            if response.headers.get('Docker-Content-Digest') != digest:
                raise ValueError('Registry manifest digest mismatch')
            return json.loads(data), digest

    def ensure_blob(self, descriptor, socket):
        try:
            with self.request(self.path + '/blobs/' + descriptor['digest'], method='HEAD') as response:
                if int(response.headers['Content-Length']) != descriptor['size']:
                    raise ValueError('Registry blob size mismatch')
            return
        except urllib.error.HTTPError as exc:
            if exc.code in [301, 302, 307, 308]:
                return  # Do not forward authorization to object storage.
            if exc.code != 404:
                raise
        blob = subprocess.check_output(['ctr', '--address', socket, '--namespace', 'moby',
                                        'content', 'get', descriptor['digest']], timeout=60)
        if len(blob) != descriptor['size'] or 'sha256:' + hashlib.sha256(blob).hexdigest() != descriptor['digest']:
            raise ValueError('Local blob digest mismatch')
        with self.request(self.path + '/blobs/uploads/', method='POST', data=b'') as response:
            location = response.headers['Location']
        location += ('&' if '?' in location else '?') + urllib.parse.urlencode({'digest': descriptor['digest']})
        with self.request(location, method='PUT', data=blob,
                          headers={'Content-Type': 'application/octet-stream'}) as response:
            if response.status != 201:
                raise ValueError('Blob upload not accepted')

    def publish(self, tag, manifest, expected_old):
        if self.manifest(tag)[1] != expected_old:
            raise ValueError('Remote tag changed; publication stopped')
        payload = json.dumps(manifest, separators=(',', ':')).encode()
        digest = 'sha256:' + hashlib.sha256(payload).hexdigest()
        with self.request(self.path + '/manifests/' + tag, method='PUT', data=payload,
                          headers={'Content-Type': DOCKER_MANIFEST}) as response:
            if response.status != 201 or response.headers['Docker-Content-Digest'] != digest:
                raise ValueError('Manifest publication not confirmed')
        if self.manifest(tag) != (manifest, digest):
            raise ValueError('Published manifest mismatch')
        return digest


CLEANUP = r'''
import hashlib,json,os,shutil,stat,subprocess
from pathlib import Path
def tree_digest(path,root):
    records=[]
    def visit(p):
        s=p.lstat();row=[str(p.relative_to(root)),s.st_mode,s.st_uid,s.st_gid]
        if p.is_symlink():row+=['link',os.readlink(p)]
        elif stat.S_ISREG(s.st_mode):
            h=hashlib.sha256()
            with p.open('rb') as f:
                for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
            row+=['file',s.st_size,h.hexdigest()]
        elif stat.S_ISDIR(s.st_mode):row+=['directory']
        else:raise ValueError('Unexpected special workspace file')
        records.append(row)
        if p.is_dir() and not p.is_symlink():
            for child in sorted(p.iterdir()):visit(child)
    visit(path)
    return hashlib.sha256(json.dumps(records).encode()).hexdigest()
def cleanup(item):
    root=Path('/workspace')
    if not root.is_dir() or root.is_symlink():raise ValueError('Unexpected workspace root')
    before=sorted(p.name for p in root.iterdir())
    if '.git' in before:
        if (root/'.git').is_symlink():raise ValueError('Symlinked git metadata')
        head=subprocess.check_output(['git','-c','safe.directory=/workspace','-C','/workspace','rev-parse','HEAD'],text=True).strip()
        if head!=item['commit']:raise ValueError('Image checkout does not match tag commit')
    tracked=item['tracked_roots']
    if not tracked or any(not x or '/' in x or x in ['.','..'] for x in tracked):raise ValueError('Invalid tracked root list')
    # Untracked base-image tools are retained, rather than guessed to be source.
    remove=sorted(set(before)&set(tracked+['.git','Megatron-LM','Mooncake']))
    if not remove:raise ValueError('No identifiable source entries; inspect manually')
    keep=sorted(set(before)-set(remove))
    if 'nccl-tests' in before and 'nccl-tests' not in keep:raise ValueError('Refusing to delete nccl-tests')
    preserved={x:tree_digest(root/x,root) for x in keep}
    for x in remove:
        p=root/x
        if p.is_symlink() or not p.is_dir():p.unlink()
        else:shutil.rmtree(p)
    if sorted(p.name for p in root.iterdir())!=keep:raise ValueError('Unexpected final workspace entries')
    if preserved!={x:tree_digest(root/x,root) for x in keep}:raise ValueError('Retained content changed')
    print(json.dumps({'removed':remove,'retained':keep,'preserved':preserved}))
'''

PROBE = r'''
import hashlib,importlib,importlib.metadata as md,json
packages=sorted((d.metadata.get('Name',''),d.version) for d in md.distributions())
modules={}
for name in ['torch','magi_attention','magi_attn_extensions','magi_fsdp','magi_moe','magi_compiler','odin','quack','flash_attn.cute']:
    try:
        m=importlib.import_module(name);modules[name]={'ok':True,'path':getattr(m,'__file__',None)}
    except Exception as e:modules[name]={'ok':False,'error_type':type(e).__name__}
print('KIAN_PROBE='+json.dumps({'packages':hashlib.sha256(json.dumps(packages).encode()).hexdigest(),'package_count':len(packages),'modules':modules}))
'''


def probe(ref):
    output = command(['docker', 'run', '--rm', '--network', 'none', '--cpus', '2', '--memory', '8g',
                      '--entrypoint', 'python3', ref, '-B', '-c', PROBE], timeout=240)
    lines = [line for line in output.splitlines() if line.startswith('KIAN_PROBE=')]
    if len(lines) != 1:
        raise ValueError('Missing import probe result')
    return json.loads(lines[0].split('=', 1)[1])


def verify_remote(source, digest, preview, retained):
    command(['docker', 'pull', source])
    published = inspect(source)
    if published['RootFS']['Layers'] != preview['RootFS']['Layers'] or published['Config'] != preview['Config']:
        raise ValueError('Pulled image differs from approved preview')
    if not any(x.endswith('@' + digest) for x in published['RepoDigests']):
        raise ValueError('Remote digest changed during verification')
    code = "import pathlib,json;print(json.dumps(sorted(p.name for p in pathlib.Path('/workspace').iterdir())))"
    contents = json.loads(command(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'python3', source, '-B', '-c', code]))
    if contents != retained:
        raise ValueError('Published workspace mismatch')


def validate_plan(items, aliases):
    if any(not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}', tag) for tag in aliases):
        raise ValueError('Invalid explicit alias')
    if (len({x['tag'] for x in items}) != len(items)
            or any((not re.fullmatch('[0-9a-f]{7,40}', x['tag']) and x['tag'] not in aliases)
                   or (x.get('commit') is not None and not re.fullmatch('[0-9a-f]{40}', x['commit'])) for x in items)):
        raise ValueError('Plan contains invalid or unauthorized tags')


def process_image(args, item, stage):
    tag = item['tag']
    audit = args.state_dir / 'items' / tag
    audit.mkdir(parents=True, exist_ok=True)
    receipt_path = audit / 'receipt.json'
    registry = Registry(args.repository)
    source_manifest, old_digest = registry.manifest(tag)
    source = args.repository + ':' + tag
    if receipt_path.exists():
        previous = json.loads(receipt_path.read_text())
        if previous.get('new_digest') == old_digest:
            if not previous.get('verified'):
                stage('verifying_previous_publication')
                verify_remote(source, old_digest, json.loads((audit / 'preview-inspect.json').read_text()), previous['retained'])
                previous.update(status='completed', verified=True, completed_at=datetime.now(timezone.utc).isoformat())
                write_json(receipt_path, previous)
            return previous
    if item.get('expected_digest') and item['expected_digest'] != old_digest:
        raise ValueError('Tag changed since inventory; inspect again')
    if item.get('reuse_tag'):
        reused_audit = args.state_dir / 'items' / item['reuse_tag']
        reused = json.loads((reused_audit / 'receipt.json').read_text())
        manifest = json.loads((reused_audit / 'publish-manifest.json').read_text())
        preview = json.loads((reused_audit / 'preview-inspect.json').read_text())
        if not reused.get('verified') or reused['old_digest'] != old_digest:
            raise ValueError('Reuse does not match the exact original image')
        if registry.manifest(item['reuse_tag']) != (manifest, reused['new_digest']):
            raise ValueError('Verified source tag has changed')
        write_json(audit / 'preview-inspect.json', preview)
        write_json(audit / 'publish-manifest.json', manifest)
        stage('publishing')
        digest = registry.publish(tag, manifest, old_digest)
        receipt = {**reused, 'tag': tag, 'status': 'published_unverified', 'verified': False,
                   'new_digest': digest, 'reused_from': item['reuse_tag']}
        write_json(receipt_path, receipt)
        stage('verifying_remote')
        verify_remote(source, digest, preview, reused['retained'])
        receipt.update(status='completed', verified=True, completed_at=datetime.now(timezone.utc).isoformat())
        write_json(receipt_path, receipt)
        return receipt
    if 'layers' not in source_manifest:
        return {'tag': tag, 'status': 'skipped', 'reason': 'multi-platform manifest requires separate review'}
    stage('pulling')
    command(['docker', 'pull', source])
    original = inspect(source)
    if not any(x.endswith('@' + old_digest) for x in original['RepoDigests']):
        raise ValueError('Tag moved during pull')
    if original['Config'].get('Volumes'):
        raise ValueError('Declared volumes require separate review')
    if not item.get('commit'):
        stage('resolving_image_commit')
        code = "import subprocess,json;g=['git','-c','safe.directory=/workspace','-C','/workspace'];h,t=subprocess.check_output(g+['show','-s','--format=%H %ct','HEAD'],text=True).split();print(json.dumps({'commit':h,'commit_time':int(t),'tracked_roots':subprocess.check_output(g+['ls-tree','--name-only','HEAD'],text=True).splitlines()}))"
        resolved = json.loads(command(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'python3',
                                       original['Id'], '-B', '-c', code]))
        if tag not in args.allow_alias and not resolved['commit'].startswith(tag):
            raise ValueError('Unresolved tag does not match image Git HEAD')
        item = {**item, **resolved}
        write_json(audit / 'resolved-commit.json', item)
    write_json(audit / 'original-inspect.json', original)
    stage('baseline_probe')
    baseline = probe(original['Id'])
    write_json(audit / 'baseline-probe.json', baseline)
    name = 'kian-clean-' + tag + '-' + datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
    preview_ref = 'kian-local/magicore-source-clean-preview:' + name
    cleanup_code = CLEANUP + '\ncleanup(' + repr(item) + ')\n'
    cid = command(['docker', 'create', '--name', name, '--network', 'none', '--cpus', '2', '--memory', '8g',
                   '--entrypoint', 'python3', original['Id'], '-B', '-c', cleanup_code])
    (audit / 'container-id.txt').write_text(cid + '\n')
    stage('cleaning')
    output = command(['docker', 'start', '-a', cid])
    container = json.loads(command(['docker', 'container', 'inspect', cid]))[0]
    if container['State']['ExitCode'] != 0 or container['Mounts']:
        raise ValueError('Cleanup container failed or has mounts')
    cleanup_result = json.loads(output)
    write_json(audit / 'cleanup.json', cleanup_result)
    diff = command(['docker', 'diff', cid]).splitlines()
    if not diff or any(line[2:] != '/workspace' and not line[2:].startswith('/workspace/') for line in diff):
        raise ValueError('Filesystem changed outside workspace')
    (audit / 'container-diff.txt').write_text('\n'.join(diff) + '\n')
    stage('committing')
    new_id = command(['docker', 'commit', '--change', 'ENTRYPOINT ' + json.dumps(original['Config'].get('Entrypoint') or []),
                      '--change', 'CMD ' + json.dumps(original['Config'].get('Cmd') or []),
                      '--message', 'Remove visible Magicore checkout; retain installed runtime and workspace tools', cid, preview_ref])
    preview = inspect(new_id)
    write_json(audit / 'preview-inspect.json', preview)
    verify_preview(original, preview)
    stage('verifying_preview')
    after = probe(new_id)
    write_json(audit / 'preview-probe.json', after)
    if baseline != after:
        raise ValueError('Installed packages or import results changed')
    oci = json.loads(command(['ctr', '--address', args.containerd_socket, '--namespace', 'moby', 'content', 'get', new_id]))
    manifest = docker_manifest(oci)
    if [x['digest'] for x in manifest['layers'][:-1]] != [x['digest'] for x in source_manifest['layers']]:
        raise ValueError('Original compressed layer descriptors changed')
    write_json(audit / 'publish-manifest.json', manifest)
    stage('publishing')
    registry = Registry(args.repository)
    registry.ensure_blob(manifest['config'], args.containerd_socket)
    registry.ensure_blob(manifest['layers'][-1], args.containerd_socket)
    digest = registry.publish(tag, manifest, old_digest)
    # Record publication before further checks so a post-push failure is visible and recoverable.
    receipt = {'tag': tag, 'status': 'published_unverified', 'old_digest': old_digest, 'new_digest': digest,
               'commit': item['commit'], 'verified': False, **cleanup_result}
    write_json(receipt_path, receipt)
    stage('verifying_remote')
    verify_remote(source, digest, preview, cleanup_result['retained'])
    receipt.update(status='completed', verified=True, package_count=after['package_count'],
                   completed_at=datetime.now(timezone.utc).isoformat())
    write_json(receipt_path, receipt)
    command(['docker', 'container', 'rm', cid])
    command(['docker', 'image', 'rm', preview_ref])
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--state-dir', required=True, type=Path)
    parser.add_argument('--unresolved', type=Path, help='Commit tags resolved from image Git metadata after dated commits')
    parser.add_argument('--allow-alias', action='append', default=[], help='Explicitly authorized non-commit tag; repeat per alias')
    parser.add_argument('--containerd-socket', default='/run/containerd/containerd.sock')
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--min-free-gib', type=int, default=200)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    items = sorted(json.loads(args.plan.read_text()), key=lambda x: (x['commit_time'], x['tag']))
    if args.unresolved:
        items.extend({'tag': tag, 'commit': None} for tag in json.loads(args.unresolved.read_text()))
    validate_plan(items, args.allow_alias)
    if not args.apply:
        print(json.dumps({'planned': len(items), 'oldest_first': [x['tag'] for x in items], 'apply': False}))
        return
    args.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (args.state_dir / 'batch.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    mutex = threading.Lock()
    queue = iter(items)
    previous = args.state_dir / 'status.json'
    results = json.loads(previous.read_text()).get('results', {}) if previous.exists() else {}
    tags = {x['tag'] for x in items}
    state = {'planned': len(items), 'active': {}, 'results': {k: v for k, v in results.items() if k in tags}, 'paused': False}
    write_json(previous, state)
    def update(tag, stage):
        with mutex:
            state['active'][tag] = stage
            write_json(args.state_dir / 'status.json', state)
    def worker():
        while not stop.is_set():
            with mutex:
                item = next(queue, None)
            if item is None:
                return
            tag = item['tag']
            if shutil.disk_usage('/var/lib/docker').free < args.min_free_gib * 1024**3:
                with mutex:
                    state.update(paused=True, pause_reason='low_disk')
                    write_json(args.state_dir / 'status.json', state)
                stop.set()
                return
            try:
                result = process_image(args, item, lambda stage: update(tag, stage))
            except Exception as exc:
                result = {'tag': tag, 'status': 'failed', 'error': type(exc).__name__}
                if isinstance(exc, (ValueError, RuntimeError)):
                    result['detail'] = str(exc)[:700]
                elif isinstance(exc, urllib.error.HTTPError):
                    result['http_status'] = exc.code
                receipt = args.state_dir / 'items' / tag / 'receipt.json'
                if receipt.exists():
                    result['publication_receipt'] = json.loads(receipt.read_text())
            with mutex:
                state['active'].pop(tag, None)
                state['results'][tag] = result
                write_json(args.state_dir / 'status.json', state)
                with (args.state_dir / 'events.jsonl').open('a') as handle:
                    handle.write(json.dumps(result) + '\n')
                print(json.dumps({'tag': tag, 'status': result['status'], 'done': len(state['results']),
                                  'planned': len(items)}), flush=True)
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 2))) as pool:
        for future in [pool.submit(worker) for _ in range(max(1, min(args.workers, 2)))]:
            future.result()


if __name__ == '__main__':
    main()
