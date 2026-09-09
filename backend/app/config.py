import os

from dotenv import load_dotenv

load_dotenv()

DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
DASHSCOPE_BASE_URL = os.getenv(
    "DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
)
QWEN_MODEL = os.getenv("QWEN_MODEL", "qwen3.8-flash")

# 工具调用的最大轮数(模型每一轮可以发起一次工具调用,之后再次请求)
MAX_TOOL_ROUNDS = int(os.getenv("MAX_TOOL_ROUNDS", "5"))
# 抓取网页正文的最大字符数,避免超出模型上下文
FETCH_MAX_CHARS = int(os.getenv("FETCH_MAX_CHARS", "6000"))
