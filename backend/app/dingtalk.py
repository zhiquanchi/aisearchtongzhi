"""钉钉自定义机器人推送(支持加签)。"""

import base64
import hashlib
import hmac
import time
import urllib.parse

import httpx


def _signed_url(webhook: str, secret: str) -> str:
    timestamp = str(round(time.time() * 1000))
    string_to_sign = f"{timestamp}\n{secret}"
    hmac_code = hmac.new(
        secret.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha256
    ).digest()
    sign = urllib.parse.quote_plus(base64.b64encode(hmac_code))
    sep = "&" if "?" in webhook else "?"
    return f"{webhook}{sep}timestamp={timestamp}&sign={sign}"


def send_markdown(webhook: str, secret: str, title: str, text: str) -> dict:
    """发送 markdown 消息到钉钉机器人,失败时抛异常。"""
    if not webhook.startswith("http"):
        raise ValueError("钉钉 Webhook 地址不合法")
    url = _signed_url(webhook, secret) if secret else webhook
    resp = httpx.post(
        url,
        json={"msgtype": "markdown", "markdown": {"title": title, "text": text}},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("errcode") != 0:
        raise RuntimeError(f"钉钉返回错误: {data.get('errmsg')}")
    return data
