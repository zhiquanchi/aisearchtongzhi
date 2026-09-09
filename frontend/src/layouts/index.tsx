import type { ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'umi';
import { App as AntdApp, Tag } from 'antd';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import './layout.less';

const NAV = [
  { path: '/', label: 'AI 搜索' },
  { path: '/config', label: '任务配置' },
];

export default function Layout(_: { children?: ReactNode }) {
  const location = useLocation();
  return (
    <ConfigProvider locale={zhCN}>
      <AntdApp className="app-shell">
        <header className="header">
        <Link to="/" className="logo">
          <span className="logo-badge">通</span>
          <span>通智 AI 搜索</span>
        </Link>
        <nav className="nav">
          {NAV.map((n) => (
            <Link
              key={n.path}
              to={n.path}
              className={location.pathname === n.path ? 'active' : ''}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <Tag>qwen3.8-flash</Tag>
      </header>
      <div className="app-body">
        <Outlet />
      </div>
      </AntdApp>
    </ConfigProvider>
  );
}
