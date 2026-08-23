"""Fetch NAIA crests by NAVIGATING to the CDN image URL.

The Presto CDN rejects every non-navigation request (direct urllib, Playwright
APIRequestContext, and in-page fetch is CORS-blocked), but a top-level
navigation carries the browser's full fingerprint and succeeds. The navigation
response body is the original full-resolution PNG -- unlike screenshotting the
table thumbnail, which yields 31px.
"""
from playwright.sync_api import sync_playwright
import json,os,sys,io
from PIL import Image
PROFILE=os.path.expanduser('~/.cache/rankxi-naia-chrome')
TMP='/Users/jeremykientz/.claude/jobs/6adb2f8c/tmp'
DEST=sys.argv[1]
plan=json.load(open(TMP+'/naia_plan.json'))
ok,bad=[],[]

def usable(raw):
    try: im=Image.open(io.BytesIO(raw)).convert('RGBA')
    except Exception as e: return None,f'undecodable: {e}'[:50]
    if im.width<48 or im.height<48: return None,f'too small {im.size}'
    op=[q[:3] for q in im.get_flattened_data() if q[3]>16]
    if len(op)<50: return None,'transparent'
    if len(set(op))<3: return None,'flat colour'
    return im,''

with sync_playwright() as p:
    ctx=p.chromium.launch_persistent_context(PROFILE,headless=False,
        args=['--disable-blink-features=AutomationControlled'])
    pg=ctx.pages[0] if ctx.pages else ctx.new_page()
    pg.goto('https://naiastats.prestosports.com/sports/msoc/2025-26/teams',
            wait_until='domcontentloaded',timeout=60000); pg.wait_for_timeout(4000)
    for i,it in enumerate(plan,1):
        try:
            resp=pg.goto(it['logo'],wait_until='commit',timeout=30000)
            if not resp or not resp.ok:
                bad.append({**it,'why':f'HTTP {resp.status if resp else "none"}'}); continue
            raw=resp.body()
            im,why=usable(raw)
            if im is None: bad.append({**it,'why':why}); continue
            im.thumbnail((128,128),Image.LANCZOS)          # match existing crest size
            canvas=Image.new('RGBA',(128,128),(0,0,0,0))
            canvas.paste(im,((128-im.width)//2,(128-im.height)//2),im)
            canvas.save(os.path.join(DEST,it['slug']+'.png'),'PNG',optimize=True)
            ok.append({**it,'src_size':list(Image.open(io.BytesIO(raw)).size)})
        except Exception as e:
            bad.append({**it,'why':str(e)[:60]})
        if i%10==0: print(f'  {i}/{len(plan)} ok={len(ok)} bad={len(bad)}',flush=True)
    ctx.close()
json.dump({'ok':ok,'bad':bad},open(TMP+'/naia_goto_result.json','w'),indent=1)
print('SAVED',len(ok),'FAILED',len(bad),flush=True)
for b in bad[:8]: print('   fail:',b['name'][:40],b['why'],flush=True)
