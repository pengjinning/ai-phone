import { useMemo, useState } from 'react'
import { Layout, Menu, Typography, Badge } from 'antd'
import {
  DashboardOutlined,
  PhoneOutlined,
  CustomerServiceOutlined,
  HistoryOutlined,
} from '@ant-design/icons'
import DashboardPage from './pages/Dashboard'
import CallPage from './pages/Call'
import RelayConsole from './pages/RelayConsole'
import HistoryPage from './pages/History'
import { StatusProvider, useStatus } from './hooks/useStatus'

const { Sider, Header, Content } = Layout

function DaemonBadge() {
  const { daemonAlive } = useStatus()
  return (
    <Badge
      status={daemonAlive === null ? 'default' : daemonAlive ? 'success' : 'error'}
      text={
        daemonAlive === null
          ? '连接中…'
          : daemonAlive
            ? 'ai-phone 运行中'
            : 'ai-phone 未运行'
      }
    />
  )
}

export default function App() {
  const [page, setPage] = useState('dashboard')
  const items = useMemo(
    () => [
      { key: 'dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
      { key: 'call', icon: <PhoneOutlined />, label: '拨打电话' },
      { key: 'relay', icon: <CustomerServiceOutlined />, label: '中继控制台' },
      { key: 'history', icon: <HistoryOutlined />, label: '通话记录' },
    ],
    [],
  )
  return (
    <StatusProvider>
      <Layout style={{ minHeight: '100vh' }}>
        <Sider theme="light" breakpoint="lg" collapsedWidth={0}>
          <div style={{ padding: 20, fontWeight: 700, fontSize: 18 }}>
            📞 ai-phone
          </div>
          <Menu mode="inline" selectedKeys={[page]} items={items} onClick={(e) => setPage(e.key)} />
        </Sider>
        <Layout>
          <Header
            style={{
              background: '#fff',
              padding: '0 24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            <Typography.Title level={5} style={{ margin: 0 }}>
              {items.find((i) => i.key === page)?.label}
            </Typography.Title>
            <DaemonBadge />
          </Header>
          <Content style={{ padding: 24 }}>
            {page === 'dashboard' && <DashboardPage />}
            {page === 'call' && <CallPage />}
            {page === 'relay' && <RelayConsole />}
            {page === 'history' && <HistoryPage />}
          </Content>
        </Layout>
      </Layout>
    </StatusProvider>
  )
}
