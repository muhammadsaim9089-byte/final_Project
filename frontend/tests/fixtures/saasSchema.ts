/**
 * A realistic multi-tenant SaaS schema of the kind the AI generator produces: 30 tables in 6 table groups, with
 * `tenants` and `users` referenced from almost every table (the "hub" pattern behind cable explosions).
 * Used by tests/layout_widescreen.test.ts.
 */
const T = (name: string, cols: string[], refs: string[] = []) =>
  `Table ${name} {\n  id bigint [pk]\n${cols.map((c) => `  ${c}\n`).join("")}${refs.map((r) => `  ${r}_id bigint [ref: > ${r === "author" || r === "assignee" || r === "owner" || r === "created_by" ? "users" : r + "s"}.id]\n`).join("")}  created_at timestamptz\n}\n`;

const tenantScoped = (name: string, cols: string[], refs: string[] = []) => T(name, cols, ["tenant", "created_by", ...refs]);

export const SAAS_DBML = [
  T("tenants", ["name varchar", "plan varchar", "region varchar"]),
  T("users", ["email varchar", "full_name varchar", "locale varchar"], ["tenant"]),
  tenantScoped("roles", ["name varchar"]),
  tenantScoped("memberships", ["role_id bigint [ref: > roles.id]"], ["user"]),
  tenantScoped("api_keys", ["prefix varchar", "hashed varchar"], ["user"]),
  tenantScoped("audit_logs", ["action varchar", "payload jsonb"], ["user"]),
  // projects
  tenantScoped("projects", ["name varchar", "status varchar"], ["owner"]),
  tenantScoped("project_members", ["project_id bigint [ref: > projects.id]"], ["user"]),
  tenantScoped("milestones", ["project_id bigint [ref: > projects.id]", "due_on date"]),
  tenantScoped("tasks", ["project_id bigint [ref: > projects.id]", "milestone_id bigint [ref: > milestones.id]", "title varchar", "priority int"], ["assignee"]),
  tenantScoped("task_comments", ["task_id bigint [ref: > tasks.id]", "body text"], ["author"]),
  tenantScoped("task_attachments", ["task_id bigint [ref: > tasks.id]", "url varchar"]),
  tenantScoped("labels", ["name varchar", "color varchar"]),
  tenantScoped("task_labels", ["task_id bigint [ref: > tasks.id]", "label_id bigint [ref: > labels.id]"]),
  // billing
  tenantScoped("plans", ["name varchar", "price_amount bigint"]),
  tenantScoped("subscriptions", ["plan_id bigint [ref: > plans.id]", "status varchar"]),
  tenantScoped("invoices", ["subscription_id bigint [ref: > subscriptions.id]", "total_amount bigint"]),
  tenantScoped("invoice_lines", ["invoice_id bigint [ref: > invoices.id]", "amount bigint"]),
  tenantScoped("payments", ["invoice_id bigint [ref: > invoices.id]", "amount bigint"]),
  tenantScoped("payment_methods", ["brand varchar", "last4 char(4)"], ["user"]),
  // messaging
  tenantScoped("channels", ["name varchar"]),
  tenantScoped("channel_members", ["channel_id bigint [ref: > channels.id]"], ["user"]),
  tenantScoped("messages", ["channel_id bigint [ref: > channels.id]", "body text"], ["author"]),
  tenantScoped("reactions", ["message_id bigint [ref: > messages.id]", "emoji varchar"], ["user"]),
  tenantScoped("notifications", ["kind varchar", "read_at timestamptz"], ["user"]),
  // analytics
  tenantScoped("events", ["name varchar", "props jsonb"], ["user"]),
  tenantScoped("sessions", ["started_at timestamptz"], ["user"]),
  tenantScoped("page_views", ["session_id bigint [ref: > sessions.id]", "path varchar"]),
  tenantScoped("feature_flags", ["key varchar", "enabled boolean"]),
  tenantScoped("experiments", ["feature_flag_id bigint [ref: > feature_flags.id]", "variant varchar"]),
].join("\n") +
  `
TableGroup identity {
  tenants
  users
  roles
  memberships
  api_keys
  audit_logs
}
TableGroup projects {
  projects
  project_members
  milestones
  tasks
  task_comments
  task_attachments
  labels
  task_labels
}
TableGroup billing {
  plans
  subscriptions
  invoices
  invoice_lines
  payments
  payment_methods
}
TableGroup messaging {
  channels
  channel_members
  messages
  reactions
  notifications
}
TableGroup analytics {
  events
  sessions
  page_views
  feature_flags
  experiments
}
`;
