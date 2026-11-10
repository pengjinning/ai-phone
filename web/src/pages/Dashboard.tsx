import { Alert, Card, Col, Empty, Row, Space, Statistic, Table, Tag, Typography } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  PhoneOutlined,
  ApiOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import type { ColumnsType } from 'antd/es/table'
import type { LineStatus } from '../../shared/types'
import { useStatus } from '../hooks/useStatus'

const STATE_TAG: Record<string, { color: string; text: string }> = {
  registered: { color: 'success', text: '已注册' },
  registering: { color: 'processing', text: '注册中' },
  unregistered: { color: 'default', text: '未注册' },
  degraded: { color: 'error', text: '异常' },
  skipped: { color: 'warning', text: '已跳过' },
}

const OUTCOME_TEXT: Record<string, string> = {
  completed: '已完成',
  busy: '占线',
  no_answer: '无应答',
  rejected: '被拒',
  redirected: '已转移',
  cancelled: '已取消',
}

export function lineStateTag(l: LineStatus) {
  // a SIP address has no registrar: unregistered reads as "listening" (mirrors cli_status.line_state)
  if (l.kind === 'sip' && l.state === 'unregistered')
    return <Tag color="success">监听中</Tag>
  const meta = STATE_TAG[l.state] ?? { color: 'default', text: l.state }
  return <Tag color={meta.color}>{meta.text}</Tag>
}

export default function Dashboard() {
  const { status, daemonAlive, events } = useStatus()

  const columns: ColumnsType<LineStatus> = [
    { title: '线路', dataIndex: 'id', key: 'id' },
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      render: (k: string) => (k === 'trunk' ? '中继' : 'SIP'),
      width: 90,
    },
    { title: '地址', dataIndex: 'address', key: 'address', ellipsis: true },
    {
      title: '状态',
      key: 'state',
      width: 110,
      render: (_, l) => lineStateTag(l),
    },
    { title: '注册服务器 / 错误', key: 'registrar', ellipsis: true, render: (_, l) => l.last_error ?? l.registrar ?? '' },
    {
      title: '更新于',
      dataIndex: 'since',
      key: 'since',
      width: 100,
      render: (t: number) => dayjs(t * 1000).format('HH:mm:ss'),
    },
  ]

  const recent = [...events].reverse().slice(0, 8)
  const lines = Object.values(status?.lines ?? {})

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {daemonAlive === false && (
        <Alert
          type="error"
          showIcon
          message="ai-phone 守护进程未运行"
          description="请在终端运行 `ai-phone run` 启动守护进程,然后刷新此页面。"
        />
      )}

      <Row gutter={16}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="守护进程"
              value={daemonAlive ? '运行中' : daemonAlive === false ? '未运行' : '…'}
              prefix={daemonAlive ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
              valueStyle={{ fontSize: 20 }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="线路" value={lines.length} suffix="条" prefix={<ApiOutlined />} valueStyle={{ fontSize: 20 }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="活动通话"
              value={status?.call ? 1 : 0}
              suffix="通"
              prefix={<PhoneOutlined />}
              valueStyle={{ fontSize: 20 }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="中继监听"
              value={status?.relay_listener ? '等待来电' : '空闲'}
              valueStyle={{ fontSize: 20 }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="活动通话" size="small">
        {status?.call || status?.active_call ? (
          <Space direction="vertical">
            <Typography.Text>
              <Tag color={status.call?.direction === 'out' ? 'blue' : 'green'}>
                {status.call?.direction === 'out' ? '呼出' : '呼入'}
              </Tag>
              <Tag>{status.call?.mode === 'relay' ? '中继' : '电话代理'}</Tag>
              通话 <Typography.Text code>{status.call?.call_id}</Typography.Text>
              于线路 <Typography.Text code>{status.call?.line}</Typography.Text>,对方{' '}
              <Typography.Text strong>{status.call?.remote}</Typography.Text>
              {status.call?.answered_at ? `,接听于 ${dayjs(status.call.answered_at * 1000).format('HH:mm:ss')}` : ''}
            </Typography.Text>
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有通话" />
        )}
      </Card>

      <Card title="线路注册状态" size="small">
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={lines}
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有配置线路" /> }}
        />
      </Card>

      <Card title="最近事件" size="small">
        {recent.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无事件" />
        ) : (
          recent.map((e, i) => (
            <Typography.Text key={i} style={{ display: 'block', fontSize: 12, color: '#888' }}>
              {JSON.stringify(e)}
            </Typography.Text>
          ))
        )}
      </Card>
    </Space>
  )
}

export { OUTCOME_TEXT }
