import { requireSupabase } from '../lib/supabase'
import type { AppNotification } from '../types'

const NOTIFICATION_LIMIT = 20

interface NotificationRow {
  id: string
  user_id: string
  title: string
  body: string
  kind: string
  order_id: string | null
  read: boolean
  created_at: string
}

function mapNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    body: row.body,
    kind: row.kind,
    orderId: row.order_id,
    read: row.read,
    createdAt: row.created_at,
  }
}

export async function fetchNotifications(
  userId: string,
): Promise<AppNotification[]> {
  const { data, error } = await requireSupabase()
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(NOTIFICATION_LIMIT)
  if (error || !data) return []
  return (data as NotificationRow[]).map(mapNotification)
}

export async function fetchUnreadCount(userId: string): Promise<number> {
  const { count, error } = await requireSupabase()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false)
  if (error) return 0
  return count ?? 0
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await requireSupabase()
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false)
}

export function subscribeNotifications(
  userId: string,
  onInsert: (notification: AppNotification) => void,
): () => void {
  const supabase = requireSupabase()
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as NotificationRow
        if (row) onInsert(mapNotification(row))
      },
    )
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}
