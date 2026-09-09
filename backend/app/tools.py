import httpx
from bs4 import BeautifulSoup

from . import config

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# fetch_webpage 的 function calling 工具定义
FETCH_WEBPAGE_TOOL = {
    "type": "function",
    "function": {
        "name": "fetch_webpage",
        "description": (
            "抓取指定 URL 的网页内容,返回页面正文文本。"
            "当用户提供了具体的网页链接,或者你需要查看某个网页的详细内容时使用。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "要抓取的网页地址,以 http:// 或 https:// 开头",
                }
            },
            "required": ["url"],
        },
    },
}


async def fetch_webpage(url: str) -> dict:
    """抓取网页并提取正文文本,返回 {"title": ..., "text": ...}。"""
    if not url.lower().startswith(("http://", "https://")):
        raise ValueError("仅支持 http/https 链接")

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    async with httpx.AsyncClient(
        follow_redirects=True, timeout=httpx.Timeout(20.0), headers=headers
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        raw = resp.text

    return _extract(raw, url, content_type)


def fetch_webpage_sync(url: str) -> dict:
    """同步版抓取,供后台定时任务线程使用。"""
    if not url.lower().startswith(("http://", "https://")):
        raise ValueError("仅支持 http/https 链接")

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    with httpx.Client(
        follow_redirects=True, timeout=httpx.Timeout(20.0), headers=headers
    ) as client:
        resp = client.get(url)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        raw = resp.text

    return _extract(raw, url, content_type)


def _extract(raw: str, url: str, content_type: str) -> dict:
    if content_type and "html" not in content_type and "xml" not in content_type:
        return {
            "title": url,
            "text": f"[非 HTML 内容,类型: {content_type}]\n{raw[: config.FETCH_MAX_CHARS]}",
        }

    soup = BeautifulSoup(raw, "html.parser")
    for tag in soup(
        ["script", "style", "noscript", "iframe", "svg", "form", "header", "footer", "nav", "aside"]
    ):
        tag.decompose()

    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()

    body = soup.body or soup
    lines = (ln.strip() for ln in body.get_text("\n").splitlines())
    text = "\n".join(ln for ln in lines if ln)
    if len(text) > config.FETCH_MAX_CHARS:
        text = text[: config.FETCH_MAX_CHARS] + f"\n...(内容过长,已截断,原文共 {len(text)} 字符)"

    return {"title": title or url, "text": text}
