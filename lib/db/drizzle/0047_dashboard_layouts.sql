CREATE TABLE IF NOT EXISTS terminal_dashboard_layouts (
	user_id text PRIMARY KEY NOT NULL,
	items jsonb NOT NULL DEFAULT '[]'::jsonb,
	active_preset text,
	updated_at timestamp NOT NULL DEFAULT now()
);
