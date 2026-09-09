from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import monitor, store
from .routes import router


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.init()
    monitor.init_scheduler()
    yield
    monitor.scheduler.shutdown(wait=False)


app = FastAPI(title="通智 AI 搜索 - 后端", lifespan=lifespan)

# 允许前端直连(dev 下走 umi proxy,CORS 作为兜底)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
