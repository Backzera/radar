# Captura de cookies do Facebook (conta OPERADORA) — sem precisar digitar no terminal.
# Abre uma janela do navegador; você loga e abre o Marketplace; o script detecta o
# login (cookie c_user) e salva os cookies em fb_cookies.json, que o serviço lê sozinho.
#
# Rodar:  .venv\Scripts\python.exe salvar_cookies.py

import json
import time

from patchright.sync_api import sync_playwright

TIMEOUT_S = 300  # 5 minutos para você logar

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    ctx = browser.new_context(locale="pt-BR")
    page = ctx.new_page()
    page.goto("https://www.facebook.com/", wait_until="domcontentloaded")
    print(">> Janela aberta. Faça login no Facebook e abra o Marketplace.", flush=True)
    print(">> Aguardando detectar o login (até 5 min)...", flush=True)

    logged = False
    start = time.time()
    while time.time() - start < TIMEOUT_S:
        try:
            cookies = ctx.cookies()
        except Exception:
            cookies = []
        if any(c.get("name") == "c_user" for c in cookies):
            logged = True
            break
        time.sleep(3)

    if not logged:
        print("TIMEOUT: login não detectado. Rode de novo e conclua o login.", flush=True)
        browser.close()
        raise SystemExit(1)

    time.sleep(6)  # tempo extra p/ garantir cookies de sessão do Marketplace
    cookies = ctx.cookies()
    with open("fb_cookies.json", "w", encoding="utf-8") as f:
        json.dump(cookies, f)
    print(f"LOGIN OK — {len(cookies)} cookies salvos em fb_cookies.json", flush=True)
    browser.close()
