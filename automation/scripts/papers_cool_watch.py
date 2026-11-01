"""Focused paper discovery from papers.cool, with durable cross-list deduplication."""
import hashlib
import html
import re
from datetime import date, datetime, timedelta
from urllib.parse import urlencode


TOPICS = {
    'GPU architecture': (4, r'gpu (?:architect|microarchitect)|(?:gpu|nvidia|hopper|blackwell).{0,40}microbenchmark|microbenchmark.{0,50}(?:gpu|nvidia|hopper|blackwell)|tensor memory accelerator|warp.speciali[sz]|thread block cluster|tensor memory|\btmem\b'),
    'GPU kernels': (5, r'gpu kernel|cuda kernel|kernel fusion|kernel optim|tensor core|gemm|matrix multipli|flash.?attention|flash.?mla|gpu microbenchmark'),
    'Compilers / autotuning': (5, r'gpu compil|kernel generat|kernel schedul|kernel synthes|automatic.*kernel|autotun|auto-tun|\btriton\b|\btilelang\b|\bcute dsl\b|tensor compil|compil.*(?:gpu|tensor|neural|machine learning)'),
    'Distributed training': (5, r'distributed training|parallel training|pipeline parallel|tensor parallel|expert parallel|sequence parallel|context parallel|fully sharded|\bfsdp\b|zero redundan|mixture.of.experts.{0,100}\b(?:system|communicat|dispatch)|\b(?:system|communicat|dispatch).{0,100}mixture.of.experts'),
    'GPU communication': (5, r'\bnccl\b|\bnvshmem\b|\brdma\b|\bnvlink\b|all.?to.?all|all.?reduce|collective communicat|communicat.*(?:overlap|gpu|training)|(?:gpu|training).*communicat'),
    'Memory / checkpointing': (4, r'gpu memory|gpu.context|activation checkpoint|activation recomput|memory offload|optimizer offload|checkpoint.*(?:training|distributed)|(?:training|distributed).*checkpoint|kv.cache|key.value cach|paged.?attention'),
    'Inference systems': (4, r'(?:llm|language model|inference|multi.model|model).{0,35}\b(?:serving|autoscal|schedul|disaggregat)|\b(?:serving|disaggregat).{0,35}(?:llm|inference|language model)|speculative decod|\bvllm\b|\bsglang\b|prefill|continuous batch'),
    'Low precision compute': (4, r'\bfp[48]\b|\bnvfp4\b|\bmxfp[48]\b|low.precision (?:training|comput|kernel)|quantized (?:gemm|matrix|kernel)|quantization.aware.*(?:kernel|system)'),
}
CONTEXT = r'\bgpu\b|\bcuda\b|\bhbm\b|\bllm\b|language model|transformer|neural network|deep learning|machine learning|tensor|\bmoe\b|mixture.of.experts|inference|distributed training'


def text(value):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', value)).split())


def parse_page(document, listing):
    heading = re.search(r'<h1\b[^>]*>(.*?)</h1>', document, re.S)
    if not heading:
        raise ValueError('Paper listing has no heading: ' + listing)
    label = text(heading[1])
    day = re.search(r'class="date">(\d{4}-\d{2}-\d{2})', document)
    starts = list(re.finditer(r'<div\b[^>]*\bid="([^"]+)"[^>]*class="panel paper"[^>]*>', document))
    papers = []
    for i, start in enumerate(starts):
        block = document[start.end():starts[i + 1].start() if i + 1 < len(starts) else len(document)]
        title = re.search(r'<a\b[^>]*class="title-link[^\"]*"[^>]*>(.*?)</a>', block, re.S)
        abstract = re.search(r'<p\b[^>]*class="summary[^\"]*"[^>]*>(.*?)</p>', block, re.S)
        if not title or not abstract:
            raise ValueError('Paper listing changed format: ' + listing)
        identifier = html.unescape(start[1])
        published = re.search(r'class="date-data">([^<]+)', block)
        stamp = datetime.strptime(published[1], '%Y-%m-%d %H:%M:%S UTC').isoformat() + 'Z' if published else None
        authors = re.findall(r'<a\b[^>]*class="author[^\"]*"[^>]*>(.*?)</a>', block, re.S)
        external = re.search(r'<a\b[^>]*href="(https://[^"]+)"[^>]*title="\d+/\d+"', block)
        arxiv = bool(re.fullmatch(r'\d{4}\.\d{4,5}(?:v\d+)?', identifier))
        link = 'https://papers.cool/' + ('arxiv/' if arxiv else 'venue/') + identifier
        papers.append({'id': re.sub(r'v\d+$', '', identifier) if arxiv else identifier,
                       'title': text(title[1]), 'body': text(abstract[1]), 'author': ', '.join(text(a) for a in authors),
                       'link': link, 'published': stamp, 'listing': label,
                       'original': 'https://arxiv.org/abs/' + identifier if arxiv else html.unescape(external[1]) if external else link})
    if not starts and not re.search(r'Total:\s*0\b', document):
        raise ValueError('Paper listing unexpectedly empty: ' + listing)
    return papers, day[1] if day else None


def importance(paper, settings):
    title, body = paper['title'], paper['body']
    if any(re.search(p, title, re.I) for p in settings.get('exclude_title_patterns', [])):
        return 0, []
    combined = title + '\n' + body
    if not re.search(CONTEXT, combined, re.I):
        return 0, []
    reasons, score, title_hit = [], 2, False
    for name in settings.get('topics', TOPICS):
        weight, pattern = TOPICS[name]
        if re.search(pattern, combined, re.I):
            score += weight
            reasons.append(name)
            title_hit = title_hit or bool(re.search(pattern, title, re.I))
    if any(re.search(p, combined, re.I) for p in settings.get('include_patterns', [])):
        score += 6
        reasons.append('Custom interest')
    return (score + (2 if title_hit else 0), reasons) if reasons else (0, [])


def keys(paper):
    normalized_title = re.sub(r'[^\w]+', '', paper['title'].casefold())
    return ['id:' + paper['id'], 'title:' + hashlib.sha256(normalized_title.encode()).hexdigest()]


def listing(fetch, url, day=None):
    papers, expected, stamp = [], None, None
    while expected is None or len(papers) < expected:
        params = dict(show=200, skip=len(papers))
        if day:
            params['date'] = day
        document = fetch(url + '?' + urlencode(params))
        total = re.search(r'Total:\s*(\d+)', document)
        if not total or int(total[1]) > 10000:
            raise ValueError('Invalid paper count: ' + url)
        expected = int(total[1])
        page, stamp = parse_page(document, url)
        if not page and expected:
            raise ValueError('Incomplete paper listing: ' + url)
        if set(p['id'] for p in page) & set(p['id'] for p in papers):
            raise ValueError('Paper pagination did not advance: ' + url)
        papers.extend(page)
    return papers, stamp


def collect(source, previous, capture_time, fetch):
    candidates = []
    listed_days = []
    for category in source.get('arxiv_categories', []):
        url = 'https://papers.cool/arxiv/' + category
        latest, latest_day = listing(fetch, url)
        if not latest_day:
            raise ValueError('arXiv listing has no date: ' + url)
        candidates.extend(latest)
        listed_days.append(latest_day)
        if previous.get('arxiv_day'):
            start = date.fromisoformat(previous['arxiv_day'])
            end = min(date.fromisoformat(latest_day), start + timedelta(days=7))
            day = start
            while day < end:
                if day.weekday() < 5:
                    papers, actual_day = listing(fetch, url, day.isoformat())
                    if actual_day != day.isoformat():
                        raise ValueError('Dated arXiv listing did not return requested day: ' + url)
                    candidates.extend(papers)
                day += timedelta(days=1)
            listed_days[-1] = end.isoformat()
    venue_baseline = set(previous.get('venue_baseline', []))
    for venue in source.get('venues', []):
        url = 'https://papers.cool/venue/' + venue
        papers, _ = listing(fetch, url)
        if venue in venue_baseline:
            candidates.extend(papers)
        else:
            venue_baseline.add(venue)
            # Existing proceedings establish a baseline rather than flooding the inbox.
            previous = dict(previous, seen=list(previous.get('seen', [])) + [key for paper in papers for key in keys(paper)])
    seen = set(previous.get('seen', []))
    selected, rejected, discovered = [], 0, len(candidates)
    for paper in candidates:
        identity = keys(paper)
        if any(k in seen for k in identity):
            continue
        score, reasons = importance(paper, source)
        if score < int(source.get('min_score', 8)):
            rejected += 1
            continue
        selected.append(dict(paper, score=score, reasons=reasons))
        seen.update(identity)
    selected.sort(key=lambda p: (p['published'] or '', p['score']), reverse=True)
    if not previous.get('last_check'):
        selected = selected[:int(source.get('bootstrap_limit', 12))]
        # Initial preview is bounded; the rest become a baseline, not a delayed flood.
        for paper in candidates:
            seen.update(keys(paper))
    return selected, {'last_check': capture_time, 'arxiv_day': min(listed_days) if listed_days else None,
                      'venue_baseline': sorted(venue_baseline), 'seen': sorted(seen),
                      'last_scan': {'candidates': discovered, 'selected': len(selected), 'rejected': rejected}}
