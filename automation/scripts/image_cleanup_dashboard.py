#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Loopback-only, read-only dashboard for a remote image-cleanup batch."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import subprocess
import threading
import time


REMOTE = '''import json,pathlib,collections,datetime,shutil
p=pathlib.Path(STATE_DIR)
s=json.loads((p/'status.json').read_text())
results=s.get('results',{})
counts=collections.Counter(r['status'] for r in results.values())
pid=int((p/'worker.pid').read_text());proc=pathlib.Path('/proc')/str(pid)
alive=proc.exists() and (proc/'stat').read_text().rsplit(')',1)[1].split()[0]!='Z' and str(p/'worker.py').encode() in (proc/'cmdline').read_bytes()
recent=sorted(({'tag':t,'completed_at':r.get('completed_at')} for t,r in results.items() if r.get('status')=='completed'),key=lambda r:r.get('completed_at') or '',reverse=True)[:12]
problems=[{'tag':t,'status':r.get('status'),'error':r.get('error') or r.get('reason') or '','detail':r.get('detail','')[:700]} for t,r in results.items() if r.get('status')!='completed']
print(json.dumps({'planned':s['planned'],'processed':len(results),'counts':dict(counts),'active':s.get('active',{}),'paused':s.get('paused',False),'pause_reason':s.get('pause_reason'),'alive':alive,'recent':recent,'problems':problems,'free_gib':round(shutil.disk_usage('/var/lib/docker').free/1024**3),'updated_at':datetime.datetime.fromtimestamp((p/'status.json').stat().st_mtime,datetime.timezone.utc).isoformat(),'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}))
'''


def snapshot(settings):
    source = 'STATE_DIR=' + repr(settings['state_dir']) + '\n' + REMOTE
    result = subprocess.run(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
                             '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2',
                             settings['host'], 'python3 -'], input=source, text=True,
                            capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError('Remote status unavailable')
    return json.loads(result.stdout)


HTML = r'''<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Magicore</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#17212c;--muted:#606b79;--panel:#fff;--track:#e4e8ed;--accent:#187d61;--bad:#b33434;--border:#dce1e7}
@media(prefers-color-scheme:dark){:root{--bg:#11161b;--fg:#e5ebf1;--muted:#a0acb9;--panel:#1a222b;--track:#293440;--accent:#58cfa5;--bad:#ff9292;--border:#34404c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px system-ui,sans-serif}main{max-width:960px;margin:auto;padding:40px 24px}header{display:flex;justify-content:space-between;align-items:start;gap:16px;flex-wrap:wrap}h1{font-size:28px;margin:0 0 10px}h2{font-size:18px;margin:28px 0 12px}p{margin:6px 0;color:var(--muted)}button{font:inherit;padding:10px 14px;color:var(--fg);background:var(--panel);border:1px solid var(--border);border-radius:8px;cursor:pointer}.hero{background:var(--panel);padding:24px;border-radius:12px;margin-top:24px}.numbers{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}.big{font-size:40px;font-weight:600;font-variant-numeric:tabular-nums}.track{height:16px;border-radius:12px;background:var(--track);overflow:hidden;margin:16px 0}.bar{height:100%;width:0;background:var(--accent);transition:width .5s}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px}.stat{padding:14px;background:var(--panel);border-radius:10px}.stat b{display:block;font-size:25px;font-variant-numeric:tabular-nums}.stat span,.meta{color:var(--muted);font-size:14px}.row{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--border);flex-wrap:wrap}code{font-size:15px}.bad{color:var(--bad)}[hidden]{display:none!important}@media(max-width:550px){main{padding:24px 16px}.stats{grid-template-columns:repeat(2,1fr)}.big{font-size:32px}}
</style>
<main><header><div><h1 id="title"></h1><p id="subtitle"></p></div><button id="refresh" type="button"></button></header>
<p id="connection" role="status" aria-live="polite"></p>
<section class="hero"><div class="numbers"><span class="big" id="percentage">—</span><span id="fraction">—</span></div><div class="track" role="progressbar" id="progress" aria-valuemin="0" aria-valuemax="100"><div class="bar" id="bar"></div></div><p id="state"></p></section>
<div class="stats"><div class="stat"><b id="done">—</b><span id="doneLabel"></span></div><div class="stat"><b id="working">—</b><span id="workingLabel"></span></div><div class="stat"><b id="pending">—</b><span id="pendingLabel"></span></div><div class="stat"><b id="failed">—</b><span id="failedLabel"></span></div></div>
<h2 id="activeTitle"></h2><div id="active"></div><h2 id="recentTitle"></h2><div id="recent"></div><section id="problemsSection" hidden><h2 id="problemsTitle"></h2><div id="problems"></div></section><p class="meta" id="updated"></p><p class="meta" id="note"></p></main>
<script>
const language='__LANGUAGE__';
const labels={zh:{title:'Magicore 镜像清理',subtitle:'旧 commit 优先 · 两路并行 · 商汤',refresh:'刷新进度',done:'已验证完成',working:'处理中',pending:'等待处理',failed:'异常 / 跳过',activeTitle:'当前任务',recentTitle:'最近完成',problemsTitle:'需要关注',loading:'正在读取进度…',connected:'实时连接正常',offline:'暂时无法连接，以下为上次成功读取的数据',empty:'暂无',running:'后台任务正常运行',complete:'全部处理并验证完成',ended:'本轮已结束，仍有异常项需要处理',stopped:'后台进程已停止，批次尚未完成',paused:'任务已暂停',verified:'已覆盖并回拉验证',observed:'读取时间',updated:'状态更新时间',space:'磁盘可用',note:'每 10 秒刷新页面数据，远端采集约每 15 秒一次。电脑休眠时此页面暂不可访问，H200 上的清理任务继续运行。',stages:{pulling:'拉取镜像',baseline_probe:'验证原始环境',cleaning:'清理源码',committing:'生成预览镜像',verifying_preview:'验证预览镜像',publishing:'发布新镜像',verifying_remote:'回拉验证',verifying_previous_publication:'补做发布验证',resolving_image_commit:'核对镜像内 commit'}},en:{title:'Magicore image cleanup',subtitle:'Oldest commits first · Two workers · Sense',refresh:'Refresh',done:'Verified',working:'Active',pending:'Pending',failed:'Issues / skipped',activeTitle:'Active tasks',recentTitle:'Recently completed',problemsTitle:'Needs attention',loading:'Loading progress…',connected:'Connected',offline:'Connection unavailable; showing the last successful snapshot',empty:'None',running:'Batch is running',complete:'All images verified',ended:'Batch finished with issues to review',stopped:'Worker stopped before batch completion',paused:'Batch paused',verified:'Published and pull-verified',observed:'Observed',updated:'State updated',space:'Free disk',note:'Page refreshes every 10 seconds; remote polling is about every 15 seconds. This page is unavailable while the Mac sleeps; the H200 batch continues.',stages:{pulling:'Pulling',baseline_probe:'Baseline checks',cleaning:'Cleaning',committing:'Committing',verifying_preview:'Preview checks',publishing:'Publishing',verifying_remote:'Pull verification',verifying_previous_publication:'Resuming verification',resolving_image_commit:'Resolving commit'}}};
const t=labels[language]||labels.zh,$=id=>document.getElementById(id);
document.title=t.title;document.documentElement.lang=language==='en'?'en':'zh-CN';
for(const [id,key] of Object.entries({title:'title',subtitle:'subtitle',refresh:'refresh',doneLabel:'done',workingLabel:'working',pendingLabel:'pending',failedLabel:'failed',activeTitle:'activeTitle',recentTitle:'recentTitle',problemsTitle:'problemsTitle',note:'note'}))$(id).textContent=t[key];
$('connection').textContent=t.loading;
function rows(id,entries){const parent=$(id);parent.replaceChildren();if(!entries.length){const p=document.createElement('p');p.textContent=t.empty;parent.append(p)}for(const [name,value]of entries){const row=document.createElement('div');row.className='row';const tag=document.createElement('code');tag.textContent=name;const detail=document.createElement('span');detail.textContent=value;row.append(tag,detail);parent.append(row)}}
function clock(value){return value?new Date(value).toLocaleString(language==='en'?'en-GB':'zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—'}
async function refresh(){try{const response=await fetch('/api/progress',{cache:'no-store'});if(!response.ok)throw Error('http');const result=await response.json();$('connection').textContent=result.available?t.connected:t.offline;$('connection').className=result.available?'':'bad';const s=result.snapshot;if(!s)return;const n=s.planned||0,done=s.counts.completed||0,active=Object.entries(s.active),issues=s.processed-done,percent=n?100*done/n:0;$('percentage').textContent=percent.toFixed(1)+'%';$('fraction').textContent=done+' / '+n+' · '+t.verified;$('bar').style.width=percent+'%';$('progress').setAttribute('aria-valuenow',percent.toFixed(1));$('progress').setAttribute('aria-label',t.title);$('done').textContent=done;$('working').textContent=active.length;$('pending').textContent=Math.max(0,n-s.processed-active.length);$('failed').textContent=issues;$('failed').className=issues?'bad':'';$('state').textContent=s.paused?t.paused:done===n?t.complete:s.alive?t.running:s.processed===n?t.ended:t.stopped;rows('active',active.map(([tag,stage])=>[tag,t.stages[stage]||stage]));rows('recent',s.recent.map(r=>[r.tag,clock(r.completed_at)]));$('problemsSection').hidden=!s.problems.length;rows('problems',s.problems.map(r=>[r.tag,[r.status,r.error,r.detail].filter(Boolean).join(' · ')]));$('updated').textContent=t.observed+' '+clock(s.observed_at)+' · '+t.updated+' '+clock(s.updated_at)+' · '+t.space+' '+s.free_gib+' GiB'}catch(e){$('connection').textContent=t.offline;$('connection').className='bad'}}
$('refresh').addEventListener('click',refresh);refresh();setInterval(refresh,10000);
</script></html>'''


def main():
    from automation_common import load_config
    config = load_config()
    if not config.get('services', {}).get('image_cleanup_dashboard', {}).get('enabled'):
        return
    settings = config['image_cleanup_dashboard']
    cache = {'available': False, 'snapshot': None}
    mutex = threading.Lock()

    def poll():
        while True:
            try:
                current = snapshot(settings)
                with mutex:
                    cache.update(available=True, snapshot=current)
            except Exception as exc:
                with mutex:
                    cache['available'] = False
                print('STATUS_UNAVAILABLE ' + type(exc).__name__, flush=True)
            time.sleep(max(5, settings.get('poll_seconds', 15)))

    threading.Thread(target=poll, daemon=True).start()
    language = settings.get('language', 'zh')
    if language not in ['zh', 'en']:
        raise ValueError('Unsupported dashboard language')
    html = HTML.replace('__LANGUAGE__', language).encode()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/':
                data, content_type = html, 'text/html; charset=utf-8'
            elif self.path == '/api/progress':
                with mutex:
                    data = json.dumps(cache).encode()
                content_type = 'application/json; charset=utf-8'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_):
            pass

    ThreadingHTTPServer(('127.0.0.1', int(settings.get('port', 8767))), Handler).serve_forever()


if __name__ == '__main__':
    main()
