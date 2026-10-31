"""Drives a playground visitor store through EmDash's plugin admin API, as the admin pages do.

Usage: drive.py <base-url> <cookie-jar> get <path> | init | admin <plugin-id> '<interaction JSON>'
The cookie jar keeps one visitor store across calls (and across Worker restarts locally).
"""
import json, ssl, sys, urllib.parse, urllib.request, http.cookiejar, os
BASE = sys.argv[1].rstrip("/")
JAR = sys.argv[2]
cj = http.cookiejar.MozillaCookieJar(JAR)
if os.path.exists(JAR): cj.load(ignore_discard=True, ignore_expires=True)
ctx = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE"))
if urllib.parse.urlsplit(BASE).hostname == "127.0.0.1":
    ctx = ssl._create_unverified_context()  # only `wrangler dev --local-protocol https` on this machine
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), urllib.request.HTTPSHandler(context=ctx), urllib.request.ProxyHandler())
def req(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method, headers={"User-Agent": "curl/8.5.0", "Accept": "*/*", "content-type": "application/json", "X-EmDash-Request": "1", **(headers or {})})
    try:
        with op.open(r, timeout=60) as resp: out = resp.status, resp.geturl(), resp.read().decode()
    except urllib.error.HTTPError as e: out = e.code, path, e.read().decode()
    cj.save(ignore_discard=True, ignore_expires=True); return out
def show(blocks, depth=0):
    for b in blocks:
        t = b.get("type"); txt = b.get("text") or b.get("title") or b.get("label") or ""
        extra = b.get("description") or ""
        acts = [(e.get("label"), e.get("action_id"), e.get("value"), e.get("url")) for e in b.get("elements", []) if isinstance(e, dict)]
        print("  " * depth + f"- {t}: {txt} {('| ' + extra) if extra else ''} {acts if acts else ''}"[:400])
        if b.get("fields"): print("  " * depth + "  fields:", json.dumps(b["fields"])[:1200])
        if b.get("rows"): print("  " * depth + "  rows:", json.dumps(b["rows"])[:500])
        if b.get("submit"): print("  " * depth + "  form submit:", json.dumps(b.get("submit"))[:200])
cmd = sys.argv[3]
if cmd == "get":
    s, u, t = req("GET", sys.argv[4], headers={"content-type": "text/html"}); print(s, u, len(t))
elif cmd == "init":
    print(req("POST", "/_playground/init")[0])
elif cmd == "admin":
    plugin = sys.argv[4]; body = json.loads(sys.argv[5])
    s, u, t = req("POST", f"/_emdash/api/plugins/{plugin}/admin", body)
    print("HTTP", s)
    try:
        d = json.loads(t); data = d.get("data", d)
        show(data.get("blocks", [])); 
        for k in data:
            if k != "blocks": print(" ", k, json.dumps(data[k])[:300])
    except Exception: print(t[:800])
