import { defineConfig } from 'umi';

export default defineConfig({
  title: '通智 AI 搜索',
  routes: [
    { path: '/', component: '@/pages/index' },
    { path: '/config', component: '@/pages/config' },
  ],
  // 开发态将 /api 代理到 FastAPI 后端
  proxy: {
    '/api': {
      target: 'http://127.0.0.1:8000',
      changeOrigin: true,
    },
  },
  mfsu: false,
});
