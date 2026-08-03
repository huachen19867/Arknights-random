-- 抽卡事件：匿名抽取动作计数（保留 90 天，只存散列与分类，不存抽取结果）
CREATE TABLE draw_events (
  event_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  day_cn TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  device TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX idx_draw_events_day ON draw_events(day_cn);
CREATE INDEX idx_draw_events_day_device ON draw_events(day_cn, device);
CREATE INDEX idx_draw_events_day_source ON draw_events(day_cn, source);
CREATE INDEX idx_draw_events_received_at ON draw_events(received_at);

-- 抽卡统计飞书记录映射（与访问统计 base_record_map 独立，避免唯一键跨表冲突）
CREATE TABLE draw_record_map (
  metric_key TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
