-- 匿名访问统计：原始事件（保留 90 天）、限流桶、飞书记录映射、同步状态
CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  day_cn TEXT NOT NULL,
  route TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  session_hash TEXT NOT NULL,
  device TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX idx_events_day ON events(day_cn);
CREATE INDEX idx_events_day_route ON events(day_cn, route);
CREATE INDEX idx_events_received_at ON events(received_at);

CREATE TABLE rate_buckets (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  event_count INTEGER NOT NULL
);

CREATE TABLE base_record_map (
  metric_key TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sync_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);