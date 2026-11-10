import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Drawer, Table, Tag, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { ColumnsType } from 'antd/es/table'
import type { CallHistoryEntry } from '../../shared/types'
import { api } from '../api/client'
import { useStatus } from '../hooks/useStatus'
import { OUTCOME_TEXT } from './Dashboard'
import type { HistoryListItem } from '../api/client'

export default function HistoryPage() {
  const { historyRev } = useStatus()
  const [rows, setRows] = useState<HistoryListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<CallHistoryEntry | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await api.history())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, historyRev])

  const openDetail = async (id: string) => {
    const entry = await api.historyEntry(id)
    setDetail(entry)
    setDetailOpen(true)
  }

  const columns: ColumnsType<HistoryListItem> = [
    {
      title: '通话',
      dataIndex: 'call_id',
      key: 'call_id',
      render: (id: string) => <Typography.Text code>{id}</Typography.Text>,
      width: 90,
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 160,
      render: (t: number) => dayjs(t * 1000).format('MM-DD HH:mm:ss'),
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.created_at - b.created_at,
    },
    { title: '对方', dataIndex: 'to', key: 'to', ellipsis: true },
    {
      title: '模式',
      dataIndex: 'mode',
      key: 'mode',
      width: 90,
      render: (m: string) => (m === 'relay' ? <Tag color="purple">中继</Tag> : <Tag color="blue">电话代理</Tag>),
    },
    { title: '线路', dataIndex: 'line', key: 'line', width: 100, render: (l: string | null) => l ?? '—' },
    {
      title: '结果',
      dataIndex: 'outcome',
      key: 'outcome',
      width: 100,
      render: (o: string | null, r) =>
        r.error ? <Tag color="error">失败</Tag> : o ? <Tag>{OUTCOME_TEXT[o] ?? o}</Tag> : <Tag>—</Tag>,
    },
    {
      title: '时长',
      dataIndex: 'duration_sec',
      key: 'duration_sec',
      width: 90,
      render: (d: number | null) => (d != null ? `${d}s` : '—'),
    },
    { title: '轮次', dataIndex: 'turns', key: 'turns', width: 70 },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_, r) => (
        <Button size="small" type="link" onClick={() => openDetail(r.call_id)}>
          详情
        </Button>
      ),
    },
  ]

  return (
    <Card
      title="通话记录(经由此控制台发起的通话)"
      size="small"
      extra={
        <Button icon={<ReloadOutlined />} size="small" onClick={load} loading={loading}>
          刷新
        </Button>
      }
    >
      <Table
        rowKey="call_id"
        size="small"
        columns={columns}
        dataSource={rows}
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: false }}
      />
      <Drawer
        title={detail ? `通话 ${detail.call_id}` : ''}
        width={520}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      >
        {detail && (
          <>
            <Typography.Paragraph>
              <Tag color={detail.mode === 'relay' ? 'purple' : 'blue'}>{detail.mode === 'relay' ? '中继' : '电话代理'}</Tag>
              对方 <Typography.Text strong>{detail.to}</Typography.Text> · 线路{' '}
              <Typography.Text code>{detail.line ?? '—'}</Typography.Text>
            </Typography.Paragraph>
            {detail.prompt && (
              <Typography.Paragraph type="secondary">任务: {detail.prompt}</Typography.Paragraph>
            )}
            {detail.error && <Typography.Paragraph type="danger">错误: {detail.error}</Typography.Paragraph>}
            {detail.result && (
              <Typography.Paragraph>
                结果: {OUTCOME_TEXT[detail.result.outcome ?? ''] ?? detail.result.outcome} ·{' '}
                {detail.result.duration_sec ?? 0}s · {detail.result.transcript.length} 条转写
                {detail.result.detail ? ` · ${detail.result.detail}` : ''}
              </Typography.Paragraph>
            )}
            <Typography.Title level={5}>转写</Typography.Title>
            {(detail.result?.transcript ?? []).map((t, i) => (
              <Typography.Paragraph key={i} style={{ marginBottom: 4 }}>
                <Tag>{t.who === 'agent' ? 'AI' : '对方'}</Tag>
                {t.text}
                {t.interrupted && <Typography.Text type="warning"> [被打断]</Typography.Text>}
              </Typography.Paragraph>
            ))}            {detail.result && detail.result.transcript.length === 0 && (
              <Typography.Text type="secondary">没有转写记录</Typography.Text>
            )}
          </>
        )}
      </Drawer>
    </Card>
  )
}
