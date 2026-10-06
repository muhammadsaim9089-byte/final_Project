/**
 * Template gallery — ready-made schemas written in DBML. Picking one creates a new diagram tab.
 */
export interface DiagramTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  dbml: string;
}

const ID = "id integer [pk, increment]";
const TS = "created_at timestamp [not null, default: `now()`]";
const TS2 = `${TS}\n  updated_at timestamp [not null, default: \`now()\`]`;

export const TEMPLATE_CATEGORIES = ["Business", "Content & Social", "Services & Booking", "Education", "Healthcare & Finance", "Technology"] as const;

export const TEMPLATES: DiagramTemplate[] = [
  {
    id: "ecommerce",
    name: "E-commerce Store",
    category: "Business",
    description: "Customers, catalogue, carts, orders, payments and reviews.",
    tags: ["shop", "orders", "payments", "catalog"],
    dbml: `Project ecommerce { database_type: 'PostgreSQL' }

Table customers {
  ${ID}
  email varchar(255) [unique, not null]
  full_name varchar(150) [not null]
  phone varchar(30)
  ${TS}
}
Table addresses {
  ${ID}
  customer_id integer [not null]
  line1 varchar(255) [not null]
  city varchar(100) [not null]
  postal_code varchar(20)
  country char(2) [not null]
  is_default boolean [default: false]
}
Table categories {
  ${ID}
  parent_id integer
  name varchar(120) [not null]
  slug varchar(140) [unique, not null]
}
Table products {
  ${ID}
  category_id integer
  sku varchar(64) [unique, not null]
  name varchar(200) [not null]
  description text
  price decimal(10,2) [not null]
  stock integer [not null, default: 0]
  ${TS2}
  indexes { name }
}
Table carts {
  ${ID}
  customer_id integer [not null]
  ${TS}
}
Table cart_items {
  cart_id integer
  product_id integer
  quantity integer [not null, default: 1]
  indexes { (cart_id, product_id) [pk] }
}
Enum order_status { pending paid shipped delivered cancelled refunded }
Table orders {
  ${ID}
  customer_id integer [not null]
  shipping_address_id integer
  status order_status [not null, default: 'pending']
  total decimal(12,2) [not null]
  placed_at timestamp [not null, default: \`now()\`]
}
Table order_items {
  ${ID}
  order_id integer [not null]
  product_id integer [not null]
  unit_price decimal(10,2) [not null]
  quantity integer [not null]
}
Table payments {
  ${ID}
  order_id integer [not null]
  provider varchar(40) [not null]
  amount decimal(12,2) [not null]
  paid_at timestamp
}
Table reviews {
  ${ID}
  product_id integer [not null]
  customer_id integer [not null]
  rating smallint [not null, note: '1-5']
  body text
  ${TS}
}

Ref: addresses.customer_id > customers.id [delete: cascade]
Ref: categories.parent_id > categories.id
Ref: products.category_id > categories.id
Ref: carts.customer_id > customers.id [delete: cascade]
Ref: cart_items.cart_id > carts.id [delete: cascade]
Ref: cart_items.product_id > products.id
Ref: orders.customer_id > customers.id
Ref: orders.shipping_address_id >? addresses.id
Ref: order_items.order_id > orders.id [delete: cascade]
Ref: order_items.product_id > products.id
Ref: payments.order_id > orders.id
Ref: reviews.product_id > products.id
Ref: reviews.customer_id > customers.id

TableGroup catalog [color: #10B981] { categories products reviews }
TableGroup sales [color: #4A90D9] { carts cart_items orders order_items payments }
TableGroup people [color: #F59E0B] { customers addresses }
`,
  },
  {
    id: "blog-cms",
    name: "Blog / CMS",
    category: "Content & Social",
    description: "Authors, posts, categories, tags, comments and media.",
    tags: ["blog", "cms", "content"],
    dbml: `Table users {
  ${ID}
  username varchar(60) [unique, not null]
  email varchar(255) [unique, not null]
  role varchar(20) [default: 'author']
  ${TS}
}
Table posts {
  ${ID}
  author_id integer [not null]
  title varchar(255) [not null]
  slug varchar(280) [unique, not null]
  body text
  status varchar(20) [default: 'draft']
  published_at timestamp
  ${TS2}
}
Table categories { ${ID} name varchar(100) [unique, not null] }
Table post_categories {
  post_id integer
  category_id integer
  indexes { (post_id, category_id) [pk] }
}
Table tags { ${ID} name varchar(60) [unique, not null] }
Table post_tags {
  post_id integer
  tag_id integer
  indexes { (post_id, tag_id) [pk] }
}
Table comments {
  ${ID}
  post_id integer [not null]
  user_id integer
  parent_id integer
  body text [not null]
  ${TS}
}
Table media {
  ${ID}
  uploader_id integer [not null]
  url varchar(500) [not null]
  mime_type varchar(80)
  ${TS}
}
Ref: posts.author_id > users.id
Ref: post_categories.post_id > posts.id [delete: cascade]
Ref: post_categories.category_id > categories.id [delete: cascade]
Ref: post_tags.post_id > posts.id [delete: cascade]
Ref: post_tags.tag_id > tags.id [delete: cascade]
Ref: comments.post_id > posts.id [delete: cascade]
Ref: comments.user_id >? users.id
Ref: comments.parent_id > comments.id
Ref: media.uploader_id > users.id
`,
  },
  {
    id: "social-network",
    name: "Social Network",
    category: "Content & Social",
    description: "Profiles, follows, posts, likes, messages and notifications.",
    tags: ["social", "feed", "messages"],
    dbml: `Table users {
  ${ID}
  handle varchar(40) [unique, not null]
  email varchar(255) [unique, not null]
  display_name varchar(120)
  bio text
  avatar_url varchar(500)
  ${TS}
}
Table follows {
  follower_id integer
  followee_id integer
  followed_at timestamp [default: \`now()\`]
  indexes { (follower_id, followee_id) [pk] }
}
Table posts {
  ${ID}
  user_id integer [not null]
  body text [not null]
  reply_to_id integer
  ${TS}
}
Table post_media { ${ID} post_id integer [not null] url varchar(500) [not null] kind varchar(20) }
Table likes {
  user_id integer
  post_id integer
  indexes { (user_id, post_id) [pk] }
}
Table conversations { ${ID} ${TS} }
Table conversation_members {
  conversation_id integer
  user_id integer
  indexes { (conversation_id, user_id) [pk] }
}
Table messages {
  ${ID}
  conversation_id integer [not null]
  sender_id integer [not null]
  body text [not null]
  sent_at timestamp [default: \`now()\`]
}
Table notifications {
  ${ID}
  user_id integer [not null]
  kind varchar(30) [not null]
  payload json
  read_at timestamp
  ${TS}
}
Ref: follows.follower_id > users.id
Ref: follows.followee_id > users.id
Ref: posts.user_id > users.id
Ref: posts.reply_to_id >? posts.id
Ref: post_media.post_id > posts.id [delete: cascade]
Ref: likes.user_id > users.id
Ref: likes.post_id > posts.id [delete: cascade]
Ref: conversation_members.conversation_id > conversations.id
Ref: conversation_members.user_id > users.id
Ref: messages.conversation_id > conversations.id
Ref: messages.sender_id > users.id
Ref: notifications.user_id > users.id
`,
  },
  {
    id: "forum",
    name: "Discussion Forum",
    category: "Content & Social",
    description: "Boards, threads, replies, votes and moderation.",
    tags: ["forum", "community", "moderation"],
    dbml: `Table members { ${ID} username varchar(50) [unique, not null] email varchar(255) [unique, not null] reputation integer [default: 0] joined_at timestamp [default: \`now()\`] }
Table boards { ${ID} name varchar(100) [not null] description text position integer }
Table threads {
  ${ID}
  board_id integer [not null]
  author_id integer [not null]
  title varchar(255) [not null]
  is_pinned boolean [default: false]
  is_locked boolean [default: false]
  ${TS}
}
Table replies {
  ${ID}
  thread_id integer [not null]
  author_id integer [not null]
  body text [not null]
  ${TS}
}
Table votes {
  member_id integer
  reply_id integer
  value smallint [not null, note: '+1 or -1']
  indexes { (member_id, reply_id) [pk] }
}
Table reports {
  ${ID}
  reporter_id integer [not null]
  reply_id integer [not null]
  reason varchar(255)
  resolved boolean [default: false]
  ${TS}
}
Table badges { ${ID} name varchar(60) [unique] icon varchar(200) }
Table member_badges { member_id integer badge_id integer awarded_at timestamp [default: \`now()\`]
  indexes { (member_id, badge_id) [pk] } }
Ref: threads.board_id > boards.id
Ref: threads.author_id > members.id
Ref: replies.thread_id > threads.id [delete: cascade]
Ref: replies.author_id > members.id
Ref: votes.member_id > members.id
Ref: votes.reply_id > replies.id [delete: cascade]
Ref: reports.reporter_id > members.id
Ref: reports.reply_id > replies.id
Ref: member_badges.member_id > members.id
Ref: member_badges.badge_id > badges.id
`,
  },
  {
    id: "video-streaming",
    name: "Video Streaming",
    category: "Content & Social",
    description: "Titles, seasons, episodes, subscriptions and watch history.",
    tags: ["streaming", "media", "subscriptions"],
    dbml: `Table accounts { ${ID} email varchar(255) [unique, not null] country char(2) ${TS} }
Table profiles { ${ID} account_id integer [not null] name varchar(60) [not null] is_kids boolean [default: false] }
Table plans { ${ID} name varchar(40) [not null] monthly_price decimal(6,2) [not null] max_quality varchar(10) }
Table subscriptions {
  ${ID}
  account_id integer [not null]
  plan_id integer [not null]
  starts_on date [not null]
  ends_on date
}
Enum title_kind { movie series }
Table titles { ${ID} kind title_kind [not null] name varchar(200) [not null] release_year smallint synopsis text maturity_rating varchar(10) }
Table seasons { ${ID} title_id integer [not null] number smallint [not null] }
Table episodes { ${ID} season_id integer [not null] number smallint [not null] name varchar(200) duration_min smallint }
Table genres { ${ID} name varchar(60) [unique] }
Table title_genres { title_id integer genre_id integer indexes { (title_id, genre_id) [pk] } }
Table watch_history {
  ${ID}
  profile_id integer [not null]
  title_id integer [not null]
  episode_id integer
  position_sec integer [default: 0]
  watched_at timestamp [default: \`now()\`]
}
Ref: profiles.account_id > accounts.id [delete: cascade]
Ref: subscriptions.account_id > accounts.id
Ref: subscriptions.plan_id > plans.id
Ref: seasons.title_id > titles.id
Ref: episodes.season_id > seasons.id
Ref: title_genres.title_id > titles.id
Ref: title_genres.genre_id > genres.id
Ref: watch_history.profile_id > profiles.id
Ref: watch_history.title_id > titles.id
Ref: watch_history.episode_id >? episodes.id
`,
  },
  {
    id: "crm",
    name: "CRM",
    category: "Business",
    description: "Accounts, contacts, deals, pipeline stages, activities and tasks.",
    tags: ["sales", "pipeline", "contacts"],
    dbml: `Table users { ${ID} name varchar(120) [not null] email varchar(255) [unique, not null] role varchar(30) }
Table accounts { ${ID} name varchar(200) [not null] industry varchar(80) website varchar(255) owner_id integer ${TS} }
Table contacts {
  ${ID}
  account_id integer
  first_name varchar(80) [not null]
  last_name varchar(80) [not null]
  email varchar(255)
  phone varchar(40)
  title varchar(100)
}
Table pipelines { ${ID} name varchar(80) [not null] }
Table stages { ${ID} pipeline_id integer [not null] name varchar(80) [not null] position integer [not null] win_probability smallint }
Table deals {
  ${ID}
  account_id integer [not null]
  stage_id integer [not null]
  owner_id integer [not null]
  name varchar(200) [not null]
  amount decimal(12,2)
  expected_close date
  ${TS2}
}
Table deal_contacts { deal_id integer contact_id integer role varchar(50) indexes { (deal_id, contact_id) [pk] } }
Table activities {
  ${ID}
  deal_id integer
  contact_id integer
  user_id integer [not null]
  kind varchar(20) [not null, note: 'call | email | meeting | note']
  notes text
  occurred_at timestamp [not null]
}
Table tasks { ${ID} assignee_id integer [not null] deal_id integer title varchar(200) [not null] due_on date done boolean [default: false] }
Ref: accounts.owner_id >? users.id
Ref: contacts.account_id >? accounts.id
Ref: stages.pipeline_id > pipelines.id
Ref: deals.account_id > accounts.id
Ref: deals.stage_id > stages.id
Ref: deals.owner_id > users.id
Ref: deal_contacts.deal_id > deals.id
Ref: deal_contacts.contact_id > contacts.id
Ref: activities.deal_id >? deals.id
Ref: activities.contact_id >? contacts.id
Ref: activities.user_id > users.id
Ref: tasks.assignee_id > users.id
Ref: tasks.deal_id >? deals.id
`,
  },
  {
    id: "hr",
    name: "Human Resources",
    category: "Business",
    description: "Employees, departments, positions, payroll, leave and reviews.",
    tags: ["hr", "payroll", "employees"],
    dbml: `Table departments { ${ID} name varchar(100) [unique, not null] manager_id integer }
Table positions { ${ID} title varchar(120) [not null] min_salary decimal(10,2) max_salary decimal(10,2) }
Table employees {
  ${ID}
  first_name varchar(80) [not null]
  last_name varchar(80) [not null]
  email varchar(255) [unique, not null]
  hire_date date [not null]
  department_id integer [not null]
  position_id integer [not null]
  manager_id integer
  salary decimal(10,2)
  status varchar(20) [default: 'active']
}
Table payslips { ${ID} employee_id integer [not null] period_start date [not null] period_end date [not null] gross decimal(10,2) net decimal(10,2) paid_on date }
Table leave_types { ${ID} name varchar(60) [unique] days_per_year smallint }
Table leave_requests {
  ${ID}
  employee_id integer [not null]
  leave_type_id integer [not null]
  starts_on date [not null]
  ends_on date [not null]
  status varchar(20) [default: 'pending']
  approved_by integer
}
Table attendance { ${ID} employee_id integer [not null] work_date date [not null] check_in time check_out time indexes { (employee_id, work_date) [unique] } }
Table performance_reviews { ${ID} employee_id integer [not null] reviewer_id integer [not null] period varchar(20) score smallint comments text }
Ref: departments.manager_id >? employees.id
Ref: employees.department_id > departments.id
Ref: employees.position_id > positions.id
Ref: employees.manager_id >? employees.id
Ref: payslips.employee_id > employees.id
Ref: leave_requests.employee_id > employees.id
Ref: leave_requests.leave_type_id > leave_types.id
Ref: leave_requests.approved_by >? employees.id
Ref: attendance.employee_id > employees.id
Ref: performance_reviews.employee_id > employees.id
Ref: performance_reviews.reviewer_id > employees.id
`,
  },
  {
    id: "inventory",
    name: "Inventory & Warehouse",
    category: "Business",
    description: "Products, suppliers, warehouses, stock levels and purchase orders.",
    tags: ["stock", "warehouse", "suppliers"],
    dbml: `Table suppliers { ${ID} name varchar(200) [not null] contact_email varchar(255) phone varchar(40) }
Table products { ${ID} sku varchar(64) [unique, not null] name varchar(200) [not null] unit varchar(20) reorder_level integer [default: 0] }
Table product_suppliers { product_id integer supplier_id integer unit_cost decimal(10,2) lead_days smallint indexes { (product_id, supplier_id) [pk] } }
Table warehouses { ${ID} name varchar(120) [not null] address varchar(255) }
Table stock_levels { warehouse_id integer product_id integer quantity integer [not null, default: 0] indexes { (warehouse_id, product_id) [pk] } }
Table stock_movements {
  ${ID}
  product_id integer [not null]
  from_warehouse_id integer
  to_warehouse_id integer
  quantity integer [not null]
  reason varchar(40)
  moved_at timestamp [default: \`now()\`]
}
Table purchase_orders { ${ID} supplier_id integer [not null] warehouse_id integer [not null] status varchar(20) [default: 'draft'] ordered_at timestamp expected_at date }
Table purchase_order_lines { ${ID} purchase_order_id integer [not null] product_id integer [not null] quantity integer [not null] unit_cost decimal(10,2) }
Ref: product_suppliers.product_id > products.id
Ref: product_suppliers.supplier_id > suppliers.id
Ref: stock_levels.warehouse_id > warehouses.id
Ref: stock_levels.product_id > products.id
Ref: stock_movements.product_id > products.id
Ref: stock_movements.from_warehouse_id >? warehouses.id
Ref: stock_movements.to_warehouse_id >? warehouses.id
Ref: purchase_orders.supplier_id > suppliers.id
Ref: purchase_orders.warehouse_id > warehouses.id
Ref: purchase_order_lines.purchase_order_id > purchase_orders.id
Ref: purchase_order_lines.product_id > products.id
`,
  },
  {
    id: "invoicing",
    name: "Invoicing & Accounting",
    category: "Business",
    description: "Clients, invoices, line items, payments, taxes and a ledger.",
    tags: ["billing", "accounting", "invoices"],
    dbml: `Table clients { ${ID} name varchar(200) [not null] email varchar(255) tax_id varchar(40) currency char(3) [default: 'USD'] }
Table tax_rates { ${ID} name varchar(60) [not null] percent decimal(5,2) [not null] }
Table invoices {
  ${ID}
  client_id integer [not null]
  number varchar(30) [unique, not null]
  issued_on date [not null]
  due_on date [not null]
  status varchar(20) [default: 'draft']
  total decimal(12,2)
}
Table invoice_lines { ${ID} invoice_id integer [not null] description varchar(255) [not null] quantity decimal(10,2) [default: 1] unit_price decimal(12,2) [not null] tax_rate_id integer }
Table payments { ${ID} invoice_id integer [not null] amount decimal(12,2) [not null] method varchar(30) received_on date [not null] }
Table accounts { ${ID} code varchar(20) [unique, not null] name varchar(150) [not null] kind varchar(20) [not null, note: 'asset | liability | equity | income | expense'] }
Table journal_entries { ${ID} entry_date date [not null] memo varchar(255) invoice_id integer }
Table journal_lines { ${ID} entry_id integer [not null] account_id integer [not null] debit decimal(12,2) [default: 0] credit decimal(12,2) [default: 0] }
Ref: invoices.client_id > clients.id
Ref: invoice_lines.invoice_id > invoices.id [delete: cascade]
Ref: invoice_lines.tax_rate_id >? tax_rates.id
Ref: payments.invoice_id > invoices.id
Ref: journal_entries.invoice_id >? invoices.id
Ref: journal_lines.entry_id > journal_entries.id [delete: cascade]
Ref: journal_lines.account_id > accounts.id
`,
  },
  {
    id: "saas-multitenant",
    name: "SaaS Multi-tenant",
    category: "Technology",
    description: "Organisations, members, roles, subscriptions, API keys and audit log.",
    tags: ["saas", "tenants", "rbac", "billing"],
    dbml: `Table organizations { ${ID} name varchar(150) [not null] slug varchar(80) [unique, not null] ${TS} }
Table users { ${ID} email varchar(255) [unique, not null] password_hash varchar(255) name varchar(120) ${TS} }
Table roles { ${ID} organization_id integer name varchar(60) [not null] permissions json indexes { (organization_id, name) [unique] } }
Table memberships { organization_id integer user_id integer role_id integer [not null] joined_at timestamp [default: \`now()\`] indexes { (organization_id, user_id) [pk] } }
Table plans { ${ID} code varchar(30) [unique, not null] name varchar(80) price_month decimal(8,2) seat_limit integer }
Table subscriptions { ${ID} organization_id integer [not null] plan_id integer [not null] status varchar(20) [default: 'active'] current_period_end timestamp }
Table api_keys { ${ID} organization_id integer [not null] name varchar(80) key_hash varchar(128) [unique, not null] last_used_at timestamp revoked_at timestamp }
Table invitations { ${ID} organization_id integer [not null] email varchar(255) [not null] token varchar(64) [unique, not null] expires_at timestamp }
Table audit_log { ${ID} organization_id integer [not null] actor_id integer action varchar(60) [not null] target varchar(120) meta json occurred_at timestamp [default: \`now()\`] }
Ref: roles.organization_id >? organizations.id
Ref: memberships.organization_id > organizations.id [delete: cascade]
Ref: memberships.user_id > users.id [delete: cascade]
Ref: memberships.role_id > roles.id
Ref: subscriptions.organization_id > organizations.id
Ref: subscriptions.plan_id > plans.id
Ref: api_keys.organization_id > organizations.id
Ref: invitations.organization_id > organizations.id
Ref: audit_log.organization_id > organizations.id
Ref: audit_log.actor_id >? users.id
`,
  },
  {
    id: "auth-rbac",
    name: "Authentication & RBAC",
    category: "Technology",
    description: "Users, sessions, OAuth accounts, roles and permissions.",
    tags: ["auth", "login", "permissions"],
    dbml: `Table users { ${ID} email varchar(255) [unique, not null] password_hash varchar(255) email_verified_at timestamp is_active boolean [default: true] ${TS} }
Table sessions { ${ID} user_id integer [not null] token_hash varchar(128) [unique, not null] ip inet user_agent varchar(255) expires_at timestamp [not null] }
Table oauth_accounts { ${ID} user_id integer [not null] provider varchar(30) [not null] provider_user_id varchar(120) [not null] indexes { (provider, provider_user_id) [unique] } }
Table roles { ${ID} name varchar(60) [unique, not null] description text }
Table permissions { ${ID} code varchar(100) [unique, not null] description text }
Table user_roles { user_id integer role_id integer indexes { (user_id, role_id) [pk] } }
Table role_permissions { role_id integer permission_id integer indexes { (role_id, permission_id) [pk] } }
Table password_resets { ${ID} user_id integer [not null] token_hash varchar(128) [not null] expires_at timestamp [not null] used_at timestamp }
Table login_attempts { ${ID} email varchar(255) success boolean ip inet attempted_at timestamp [default: \`now()\`] }
Ref: sessions.user_id > users.id [delete: cascade]
Ref: oauth_accounts.user_id > users.id [delete: cascade]
Ref: user_roles.user_id > users.id
Ref: user_roles.role_id > roles.id
Ref: role_permissions.role_id > roles.id
Ref: role_permissions.permission_id > permissions.id
Ref: password_resets.user_id > users.id
`,
  },
  {
    id: "project-management",
    name: "Project Management (Kanban)",
    category: "Technology",
    description: "Workspaces, projects, boards, issues, sprints and time tracking.",
    tags: ["jira", "kanban", "issues", "sprints"],
    dbml: `Table users { ${ID} name varchar(120) [not null] email varchar(255) [unique, not null] }
Table workspaces { ${ID} name varchar(120) [not null] owner_id integer [not null] }
Table projects { ${ID} workspace_id integer [not null] key varchar(10) [not null] name varchar(150) [not null] lead_id integer indexes { (workspace_id, key) [unique] } }
Table sprints { ${ID} project_id integer [not null] name varchar(80) starts_on date ends_on date state varchar(20) [default: 'planned'] }
Table columns { ${ID} project_id integer [not null] name varchar(60) [not null] position integer [not null] }
Enum issue_type { task bug story epic }
Table issues {
  ${ID}
  project_id integer [not null]
  column_id integer [not null]
  sprint_id integer
  reporter_id integer [not null]
  assignee_id integer
  parent_id integer
  type issue_type [not null, default: 'task']
  title varchar(255) [not null]
  description text
  priority smallint [default: 3]
  estimate_hours decimal(5,1)
  ${TS2}
}
Table labels { ${ID} project_id integer [not null] name varchar(50) [not null] color varchar(7) }
Table issue_labels { issue_id integer label_id integer indexes { (issue_id, label_id) [pk] } }
Table comments { ${ID} issue_id integer [not null] author_id integer [not null] body text [not null] ${TS} }
Table time_entries { ${ID} issue_id integer [not null] user_id integer [not null] minutes integer [not null] logged_on date [not null] }
Ref: workspaces.owner_id > users.id
Ref: projects.workspace_id > workspaces.id
Ref: projects.lead_id >? users.id
Ref: sprints.project_id > projects.id
Ref: columns.project_id > projects.id
Ref: issues.project_id > projects.id
Ref: issues.column_id > columns.id
Ref: issues.sprint_id >? sprints.id
Ref: issues.reporter_id > users.id
Ref: issues.assignee_id >? users.id
Ref: issues.parent_id >? issues.id
Ref: labels.project_id > projects.id
Ref: issue_labels.issue_id > issues.id
Ref: issue_labels.label_id > labels.id
Ref: comments.issue_id > issues.id
Ref: comments.author_id > users.id
Ref: time_entries.issue_id > issues.id
Ref: time_entries.user_id > users.id
`,
  },
  {
    id: "bug-tracker",
    name: "Bug Tracker",
    category: "Technology",
    description: "Products, releases, bugs, severities, attachments and history.",
    tags: ["qa", "bugs", "releases"],
    dbml: `Table products { ${ID} name varchar(120) [unique, not null] }
Table releases { ${ID} product_id integer [not null] version varchar(30) [not null] released_on date }
Table users { ${ID} name varchar(120) [not null] email varchar(255) [unique] role varchar(20) }
Enum severity { trivial minor major critical blocker }
Enum bug_status { new triaged in_progress resolved verified closed reopened }
Table bugs {
  ${ID}
  product_id integer [not null]
  found_in_release_id integer
  fixed_in_release_id integer
  reporter_id integer [not null]
  assignee_id integer
  title varchar(255) [not null]
  steps text
  severity severity [not null, default: 'minor']
  status bug_status [not null, default: 'new']
  ${TS2}
}
Table attachments { ${ID} bug_id integer [not null] filename varchar(255) [not null] url varchar(500) size_bytes bigint }
Table bug_comments { ${ID} bug_id integer [not null] author_id integer [not null] body text [not null] ${TS} }
Table status_history { ${ID} bug_id integer [not null] from_status bug_status to_status bug_status [not null] changed_by integer [not null] changed_at timestamp [default: \`now()\`] }
Ref: releases.product_id > products.id
Ref: bugs.product_id > products.id
Ref: bugs.found_in_release_id >? releases.id
Ref: bugs.fixed_in_release_id >? releases.id
Ref: bugs.reporter_id > users.id
Ref: bugs.assignee_id >? users.id
Ref: attachments.bug_id > bugs.id [delete: cascade]
Ref: bug_comments.bug_id > bugs.id [delete: cascade]
Ref: bug_comments.author_id > users.id
Ref: status_history.bug_id > bugs.id
Ref: status_history.changed_by > users.id
`,
  },
  {
    id: "hotel-booking",
    name: "Hotel Booking",
    category: "Services & Booking",
    description: "Hotels, rooms, guests, reservations, rates and payments.",
    tags: ["hotel", "reservation", "travel"],
    dbml: `Table hotels { ${ID} name varchar(150) [not null] city varchar(100) [not null] country char(2) stars smallint }
Table room_types { ${ID} hotel_id integer [not null] name varchar(80) [not null] capacity smallint [not null] base_rate decimal(8,2) [not null] }
Table rooms { ${ID} room_type_id integer [not null] number varchar(10) [not null] floor smallint status varchar(20) [default: 'available'] }
Table guests { ${ID} full_name varchar(150) [not null] email varchar(255) [unique] phone varchar(40) country char(2) }
Table reservations {
  ${ID}
  guest_id integer [not null]
  room_id integer [not null]
  check_in date [not null]
  check_out date [not null]
  adults smallint [default: 1]
  children smallint [default: 0]
  status varchar(20) [default: 'confirmed']
  total decimal(10,2)
}
Table seasonal_rates { ${ID} room_type_id integer [not null] starts_on date [not null] ends_on date [not null] rate decimal(8,2) [not null] }
Table services { ${ID} name varchar(100) [not null] price decimal(8,2) [not null] }
Table reservation_services { reservation_id integer service_id integer quantity smallint [default: 1] indexes { (reservation_id, service_id) [pk] } }
Table payments { ${ID} reservation_id integer [not null] amount decimal(10,2) [not null] method varchar(30) paid_at timestamp [default: \`now()\`] }
Ref: room_types.hotel_id > hotels.id
Ref: rooms.room_type_id > room_types.id
Ref: reservations.guest_id > guests.id
Ref: reservations.room_id > rooms.id
Ref: seasonal_rates.room_type_id > room_types.id
Ref: reservation_services.reservation_id > reservations.id
Ref: reservation_services.service_id > services.id
Ref: payments.reservation_id > reservations.id
`,
  },
  {
    id: "airline",
    name: "Airline Reservation",
    category: "Services & Booking",
    description: "Airports, flights, aircraft, passengers, bookings and tickets.",
    tags: ["airline", "flights", "tickets"],
    dbml: `Table airports { code char(3) [pk] name varchar(150) [not null] city varchar(100) country char(2) }
Table aircraft { ${ID} model varchar(60) [not null] seats_economy smallint seats_business smallint }
Table flights {
  ${ID}
  flight_no varchar(10) [not null]
  origin char(3) [not null]
  destination char(3) [not null]
  aircraft_id integer [not null]
  departs_at timestamp [not null]
  arrives_at timestamp [not null]
  status varchar(20) [default: 'scheduled']
}
Table passengers { ${ID} full_name varchar(150) [not null] passport_no varchar(30) [unique] date_of_birth date nationality char(2) }
Table bookings { ${ID} contact_email varchar(255) [not null] booked_at timestamp [default: \`now()\`] total decimal(10,2) status varchar(20) [default: 'held'] }
Table tickets {
  ${ID}
  booking_id integer [not null]
  flight_id integer [not null]
  passenger_id integer [not null]
  seat varchar(4)
  fare_class char(1) [not null]
  price decimal(10,2) [not null]
}
Table baggage { ${ID} ticket_id integer [not null] weight_kg decimal(5,1) tag_no varchar(20) }
Table crew { ${ID} full_name varchar(150) [not null] role varchar(30) [not null] }
Table flight_crew { flight_id integer crew_id integer indexes { (flight_id, crew_id) [pk] } }
Ref: flights.origin > airports.code
Ref: flights.destination > airports.code
Ref: flights.aircraft_id > aircraft.id
Ref: tickets.booking_id > bookings.id
Ref: tickets.flight_id > flights.id
Ref: tickets.passenger_id > passengers.id
Ref: baggage.ticket_id > tickets.id
Ref: flight_crew.flight_id > flights.id
Ref: flight_crew.crew_id > crew.id
`,
  },
  {
    id: "ride-sharing",
    name: "Ride Sharing",
    category: "Services & Booking",
    description: "Riders, drivers, vehicles, trips, fares, ratings and payments.",
    tags: ["uber", "taxi", "mobility"],
    dbml: `Table riders { ${ID} full_name varchar(120) [not null] phone varchar(30) [unique, not null] rating decimal(3,2) ${TS} }
Table drivers { ${ID} full_name varchar(120) [not null] phone varchar(30) [unique, not null] license_no varchar(40) [unique] status varchar(20) [default: 'offline'] rating decimal(3,2) }
Table vehicles { ${ID} driver_id integer [not null] plate varchar(15) [unique, not null] make varchar(40) model varchar(40) year smallint category varchar(20) }
Table trips {
  ${ID}
  rider_id integer [not null]
  driver_id integer
  vehicle_id integer
  pickup_lat decimal(9,6)
  pickup_lng decimal(9,6)
  dropoff_lat decimal(9,6)
  dropoff_lng decimal(9,6)
  requested_at timestamp [default: \`now()\`]
  started_at timestamp
  completed_at timestamp
  status varchar(20) [default: 'requested']
  distance_km decimal(6,2)
}
Table fares { trip_id integer [pk] base decimal(8,2) distance_fee decimal(8,2) time_fee decimal(8,2) surge decimal(4,2) [default: 1] total decimal(8,2) }
Table payments { ${ID} trip_id integer [not null] amount decimal(8,2) [not null] method varchar(20) paid_at timestamp }
Table ratings { ${ID} trip_id integer [not null] from_rider boolean [not null] stars smallint [not null] comment varchar(500) }
Table promo_codes { ${ID} code varchar(20) [unique, not null] percent_off smallint expires_on date }
Ref: vehicles.driver_id > drivers.id
Ref: trips.rider_id > riders.id
Ref: trips.driver_id >? drivers.id
Ref: trips.vehicle_id >? vehicles.id
Ref: fares.trip_id - trips.id
Ref: payments.trip_id > trips.id
Ref: ratings.trip_id > trips.id
`,
  },
  {
    id: "food-delivery",
    name: "Food Delivery",
    category: "Services & Booking",
    description: "Restaurants, menus, orders, couriers and deliveries.",
    tags: ["delivery", "restaurant", "menu"],
    dbml: `Table customers { ${ID} name varchar(120) [not null] phone varchar(30) [unique] }
Table restaurants { ${ID} name varchar(150) [not null] cuisine varchar(60) address varchar(255) is_open boolean [default: true] rating decimal(3,2) }
Table menu_sections { ${ID} restaurant_id integer [not null] name varchar(80) [not null] position smallint }
Table menu_items { ${ID} section_id integer [not null] name varchar(150) [not null] description text price decimal(8,2) [not null] available boolean [default: true] }
Table couriers { ${ID} name varchar(120) [not null] vehicle varchar(30) status varchar(20) [default: 'idle'] }
Table orders {
  ${ID}
  customer_id integer [not null]
  restaurant_id integer [not null]
  courier_id integer
  status varchar(20) [default: 'placed']
  subtotal decimal(8,2)
  delivery_fee decimal(6,2)
  tip decimal(6,2) [default: 0]
  placed_at timestamp [default: \`now()\`]
  delivered_at timestamp
}
Table order_items { ${ID} order_id integer [not null] menu_item_id integer [not null] quantity smallint [not null] unit_price decimal(8,2) [not null] notes varchar(255) }
Table reviews { ${ID} order_id integer [unique, not null] stars smallint [not null] comment text }
Ref: menu_sections.restaurant_id > restaurants.id
Ref: menu_items.section_id > menu_sections.id
Ref: orders.customer_id > customers.id
Ref: orders.restaurant_id > restaurants.id
Ref: orders.courier_id >? couriers.id
Ref: order_items.order_id > orders.id [delete: cascade]
Ref: order_items.menu_item_id > menu_items.id
Ref: reviews.order_id - orders.id
`,
  },
  {
    id: "event-ticketing",
    name: "Event Ticketing",
    category: "Services & Booking",
    description: "Venues, events, ticket tiers, orders and check-ins.",
    tags: ["events", "tickets", "venues"],
    dbml: `Table venues { ${ID} name varchar(150) [not null] city varchar(100) capacity integer }
Table organizers { ${ID} name varchar(150) [not null] email varchar(255) [unique] }
Table events { ${ID} organizer_id integer [not null] venue_id integer [not null] title varchar(200) [not null] description text starts_at timestamp [not null] ends_at timestamp status varchar(20) [default: 'draft'] }
Table ticket_tiers { ${ID} event_id integer [not null] name varchar(80) [not null] price decimal(8,2) [not null] quantity integer [not null] sales_start timestamp sales_end timestamp }
Table attendees { ${ID} email varchar(255) [not null] full_name varchar(150) [not null] }
Table orders { ${ID} attendee_id integer [not null] total decimal(10,2) placed_at timestamp [default: \`now()\`] status varchar(20) [default: 'paid'] }
Table tickets { ${ID} order_id integer [not null] tier_id integer [not null] code varchar(40) [unique, not null] checked_in_at timestamp }
Table discounts { ${ID} event_id integer [not null] code varchar(20) [not null] percent_off smallint uses_left integer }
Ref: events.organizer_id > organizers.id
Ref: events.venue_id > venues.id
Ref: ticket_tiers.event_id > events.id
Ref: orders.attendee_id > attendees.id
Ref: tickets.order_id > orders.id
Ref: tickets.tier_id > ticket_tiers.id
Ref: discounts.event_id > events.id
`,
  },
  {
    id: "restaurant-pos",
    name: "Restaurant POS",
    category: "Services & Booking",
    description: "Tables, waiters, menu, orders, kitchen tickets and bills.",
    tags: ["pos", "restaurant", "kitchen"],
    dbml: `Table staff { ${ID} name varchar(120) [not null] role varchar(20) [not null] pin_hash varchar(128) }
Table dining_tables { ${ID} label varchar(10) [unique, not null] seats smallint [not null] zone varchar(30) }
Table menu_items { ${ID} name varchar(150) [not null] category varchar(40) price decimal(8,2) [not null] station varchar(20) [note: 'kitchen | bar'] }
Table orders { ${ID} table_id integer [not null] waiter_id integer [not null] opened_at timestamp [default: \`now()\`] closed_at timestamp status varchar(20) [default: 'open'] guests smallint }
Table order_lines { ${ID} order_id integer [not null] menu_item_id integer [not null] quantity smallint [default: 1] note varchar(255) status varchar(20) [default: 'sent'] }
Table bills { ${ID} order_id integer [unique, not null] subtotal decimal(8,2) tax decimal(8,2) tip decimal(8,2) total decimal(8,2) paid_at timestamp method varchar(20) }
Table reservations { ${ID} table_id integer name varchar(120) party_size smallint reserved_for timestamp [not null] }
Ref: orders.table_id > dining_tables.id
Ref: orders.waiter_id > staff.id
Ref: order_lines.order_id > orders.id [delete: cascade]
Ref: order_lines.menu_item_id > menu_items.id
Ref: bills.order_id - orders.id
Ref: reservations.table_id >? dining_tables.id
`,
  },
  {
    id: "university",
    name: "University / School",
    category: "Education",
    description: "Students, courses, sections, enrolments, grades and faculty.",
    tags: ["school", "students", "grades"],
    dbml: `Table departments { ${ID} name varchar(120) [unique, not null] building varchar(60) }
Table faculty { ${ID} department_id integer [not null] full_name varchar(150) [not null] email varchar(255) [unique] title varchar(60) }
Table students { ${ID} full_name varchar(150) [not null] email varchar(255) [unique] enrolled_on date major_id integer date_of_birth date }
Table courses { ${ID} department_id integer [not null] code varchar(12) [unique, not null] title varchar(200) [not null] credits smallint [not null] }
Table prerequisites { course_id integer prereq_id integer indexes { (course_id, prereq_id) [pk] } }
Table terms { ${ID} name varchar(30) [not null] starts_on date ends_on date }
Table sections { ${ID} course_id integer [not null] term_id integer [not null] instructor_id integer [not null] room varchar(20) capacity smallint }
Table enrollments { student_id integer section_id integer grade char(2) enrolled_at timestamp [default: \`now()\`] indexes { (student_id, section_id) [pk] } }
Table attendance { ${ID} student_id integer [not null] section_id integer [not null] class_date date [not null] present boolean [default: true] }
Ref: faculty.department_id > departments.id
Ref: students.major_id >? departments.id
Ref: courses.department_id > departments.id
Ref: prerequisites.course_id > courses.id
Ref: prerequisites.prereq_id > courses.id
Ref: sections.course_id > courses.id
Ref: sections.term_id > terms.id
Ref: sections.instructor_id > faculty.id
Ref: enrollments.student_id > students.id
Ref: enrollments.section_id > sections.id
Ref: attendance.student_id > students.id
Ref: attendance.section_id > sections.id
`,
  },
  {
    id: "lms",
    name: "E-learning Platform (LMS)",
    category: "Education",
    description: "Courses, lessons, quizzes, enrolments, progress and certificates.",
    tags: ["lms", "courses", "quizzes"],
    dbml: `Table users { ${ID} name varchar(120) [not null] email varchar(255) [unique, not null] role varchar(20) [default: 'student'] }
Table courses { ${ID} instructor_id integer [not null] title varchar(200) [not null] summary text level varchar(20) price decimal(8,2) [default: 0] published boolean [default: false] }
Table modules { ${ID} course_id integer [not null] title varchar(150) [not null] position smallint [not null] }
Table lessons { ${ID} module_id integer [not null] title varchar(200) [not null] video_url varchar(500) content text duration_min smallint position smallint }
Table enrollments { ${ID} user_id integer [not null] course_id integer [not null] enrolled_at timestamp [default: \`now()\`] completed_at timestamp indexes { (user_id, course_id) [unique] } }
Table lesson_progress { user_id integer lesson_id integer completed_at timestamp indexes { (user_id, lesson_id) [pk] } }
Table quizzes { ${ID} module_id integer [not null] title varchar(150) pass_score smallint [default: 70] }
Table questions { ${ID} quiz_id integer [not null] prompt text [not null] kind varchar(20) [default: 'single'] }
Table answers { ${ID} question_id integer [not null] text varchar(500) [not null] is_correct boolean [default: false] }
Table quiz_attempts { ${ID} quiz_id integer [not null] user_id integer [not null] score smallint attempted_at timestamp [default: \`now()\`] }
Table certificates { ${ID} enrollment_id integer [unique, not null] code varchar(40) [unique, not null] issued_at timestamp [default: \`now()\`] }
Ref: courses.instructor_id > users.id
Ref: modules.course_id > courses.id
Ref: lessons.module_id > modules.id
Ref: enrollments.user_id > users.id
Ref: enrollments.course_id > courses.id
Ref: lesson_progress.user_id > users.id
Ref: lesson_progress.lesson_id > lessons.id
Ref: quizzes.module_id > modules.id
Ref: questions.quiz_id > quizzes.id
Ref: answers.question_id > questions.id
Ref: quiz_attempts.quiz_id > quizzes.id
Ref: quiz_attempts.user_id > users.id
Ref: certificates.enrollment_id - enrollments.id
`,
  },
  {
    id: "library",
    name: "Library Management",
    category: "Education",
    description: "Books, authors, copies, members, loans, holds and fines.",
    tags: ["library", "books", "loans"],
    dbml: `Table authors { ${ID} name varchar(150) [not null] born smallint }
Table publishers { ${ID} name varchar(150) [not null] }
Table books { ${ID} isbn varchar(20) [unique] title varchar(255) [not null] publisher_id integer published_year smallint language varchar(30) }
Table book_authors { book_id integer author_id integer indexes { (book_id, author_id) [pk] } }
Table copies { ${ID} book_id integer [not null] barcode varchar(30) [unique, not null] shelf varchar(20) condition varchar(20) [default: 'good'] }
Table members { ${ID} full_name varchar(150) [not null] email varchar(255) [unique] joined_on date [default: \`now()\`] status varchar(20) [default: 'active'] }
Table loans { ${ID} copy_id integer [not null] member_id integer [not null] loaned_on date [not null] due_on date [not null] returned_on date }
Table holds { ${ID} book_id integer [not null] member_id integer [not null] placed_at timestamp [default: \`now()\`] fulfilled boolean [default: false] }
Table fines { ${ID} loan_id integer [not null] amount decimal(6,2) [not null] paid boolean [default: false] }
Ref: books.publisher_id >? publishers.id
Ref: book_authors.book_id > books.id
Ref: book_authors.author_id > authors.id
Ref: copies.book_id > books.id
Ref: loans.copy_id > copies.id
Ref: loans.member_id > members.id
Ref: holds.book_id > books.id
Ref: holds.member_id > members.id
Ref: fines.loan_id > loans.id
`,
  },
  {
    id: "hospital",
    name: "Hospital Management",
    category: "Healthcare & Finance",
    description: "Patients, doctors, appointments, admissions, prescriptions and billing.",
    tags: ["hospital", "patients", "ehr"],
    dbml: `Table departments { ${ID} name varchar(100) [unique, not null] floor smallint }
Table doctors { ${ID} department_id integer [not null] full_name varchar(150) [not null] specialty varchar(80) license_no varchar(30) [unique] }
Table patients { ${ID} full_name varchar(150) [not null] date_of_birth date sex char(1) phone varchar(30) blood_type varchar(3) address varchar(255) }
Table appointments { ${ID} patient_id integer [not null] doctor_id integer [not null] scheduled_at timestamp [not null] status varchar(20) [default: 'booked'] reason varchar(255) }
Table rooms { ${ID} department_id integer [not null] number varchar(10) [not null] kind varchar(20) beds smallint }
Table admissions { ${ID} patient_id integer [not null] room_id integer [not null] admitted_at timestamp [not null] discharged_at timestamp diagnosis text }
Table medications { ${ID} name varchar(150) [not null] form varchar(30) strength varchar(30) }
Table prescriptions { ${ID} patient_id integer [not null] doctor_id integer [not null] issued_on date [default: \`now()\`] }
Table prescription_items { prescription_id integer medication_id integer dosage varchar(80) days smallint indexes { (prescription_id, medication_id) [pk] } }
Table lab_tests { ${ID} patient_id integer [not null] ordered_by integer [not null] test_name varchar(120) result text resulted_at timestamp }
Table invoices { ${ID} patient_id integer [not null] admission_id integer total decimal(10,2) paid boolean [default: false] issued_on date }
Ref: doctors.department_id > departments.id
Ref: appointments.patient_id > patients.id
Ref: appointments.doctor_id > doctors.id
Ref: rooms.department_id > departments.id
Ref: admissions.patient_id > patients.id
Ref: admissions.room_id > rooms.id
Ref: prescriptions.patient_id > patients.id
Ref: prescriptions.doctor_id > doctors.id
Ref: prescription_items.prescription_id > prescriptions.id
Ref: prescription_items.medication_id > medications.id
Ref: lab_tests.patient_id > patients.id
Ref: lab_tests.ordered_by > doctors.id
Ref: invoices.patient_id > patients.id
Ref: invoices.admission_id >? admissions.id
`,
  },
  {
    id: "banking",
    name: "Banking",
    category: "Healthcare & Finance",
    description: "Customers, accounts, transactions, cards, loans and branches.",
    tags: ["bank", "accounts", "transactions", "loans"],
    dbml: `Table branches { ${ID} name varchar(120) [not null] city varchar(100) swift varchar(11) }
Table customers { ${ID} full_name varchar(150) [not null] national_id varchar(30) [unique] email varchar(255) phone varchar(30) date_of_birth date ${TS} }
Enum account_type { checking savings business }
Table accounts { ${ID} customer_id integer [not null] branch_id integer [not null] iban varchar(34) [unique, not null] type account_type [not null] balance decimal(14,2) [not null, default: 0] currency char(3) [default: 'USD'] opened_on date status varchar(20) [default: 'active'] }
Table transactions { ${ID} account_id integer [not null] counterparty_account_id integer amount decimal(14,2) [not null] kind varchar(20) [not null] description varchar(255) posted_at timestamp [default: \`now()\`] balance_after decimal(14,2) }
Table cards { ${ID} account_id integer [not null] pan_hash varchar(128) [not null] expires_on date [not null] status varchar(20) [default: 'active'] daily_limit decimal(10,2) }
Table loans { ${ID} customer_id integer [not null] principal decimal(14,2) [not null] rate decimal(5,3) [not null] term_months smallint [not null] disbursed_on date status varchar(20) }
Table loan_payments { ${ID} loan_id integer [not null] due_on date [not null] amount decimal(12,2) [not null] paid_on date }
Table standing_orders { ${ID} account_id integer [not null] to_iban varchar(34) [not null] amount decimal(12,2) [not null] every_days smallint [not null] next_run date }
Ref: accounts.customer_id > customers.id
Ref: accounts.branch_id > branches.id
Ref: transactions.account_id > accounts.id
Ref: transactions.counterparty_account_id >? accounts.id
Ref: cards.account_id > accounts.id
Ref: loans.customer_id > customers.id
Ref: loan_payments.loan_id > loans.id
Ref: standing_orders.account_id > accounts.id
`,
  },
  {
    id: "iot-telemetry",
    name: "IoT Telemetry",
    category: "Technology",
    description: "Devices, sensors, readings, alerts and firmware.",
    tags: ["iot", "sensors", "time-series"],
    dbml: `Table sites { ${ID} name varchar(120) [not null] timezone varchar(40) lat decimal(9,6) lng decimal(9,6) }
Table firmware { ${ID} version varchar(20) [unique, not null] released_on date checksum varchar(64) }
Table devices { ${ID} site_id integer [not null] firmware_id integer serial_no varchar(40) [unique, not null] model varchar(60) status varchar(20) [default: 'online'] last_seen_at timestamp }
Table sensors { ${ID} device_id integer [not null] kind varchar(30) [not null, note: 'temperature | humidity | pressure'] unit varchar(10) }
Table readings { sensor_id integer recorded_at timestamp value double indexes { (sensor_id, recorded_at) [pk] } }
Table alert_rules { ${ID} sensor_id integer [not null] operator varchar(3) [not null] threshold double [not null] severity varchar(10) }
Table alerts { ${ID} rule_id integer [not null] triggered_at timestamp [not null] resolved_at timestamp value double }
Table commands { ${ID} device_id integer [not null] name varchar(60) [not null] payload json issued_at timestamp [default: \`now()\`] acked_at timestamp }
Ref: devices.site_id > sites.id
Ref: devices.firmware_id >? firmware.id
Ref: sensors.device_id > devices.id
Ref: readings.sensor_id > sensors.id
Ref: alert_rules.sensor_id > sensors.id
Ref: alerts.rule_id > alert_rules.id
Ref: commands.device_id > devices.id
`,
  },
  {
    id: "analytics-events",
    name: "Product Analytics",
    category: "Technology",
    description: "Events, sessions, users, funnels, experiments and cohorts.",
    tags: ["analytics", "events", "funnels", "ab-testing"],
    dbml: `Table projects { ${ID} name varchar(120) [not null] api_key varchar(64) [unique, not null] }
Table users { ${ID} project_id integer [not null] external_id varchar(120) [not null] traits json first_seen timestamp indexes { (project_id, external_id) [unique] } }
Table sessions { ${ID} user_id integer [not null] started_at timestamp [not null] ended_at timestamp device varchar(40) country char(2) referrer varchar(255) }
Table events { id bigint [pk, increment] session_id integer [not null] user_id integer [not null] name varchar(80) [not null] properties json occurred_at timestamp [not null]
  indexes { (user_id, occurred_at) name } }
Table funnels { ${ID} project_id integer [not null] name varchar(120) [not null] }
Table funnel_steps { ${ID} funnel_id integer [not null] position smallint [not null] event_name varchar(80) [not null] }
Table experiments { ${ID} project_id integer [not null] key varchar(60) [not null] status varchar(20) [default: 'running'] started_at timestamp }
Table variants { ${ID} experiment_id integer [not null] name varchar(40) [not null] weight smallint [default: 50] }
Table assignments { user_id integer experiment_id integer variant_id integer [not null] assigned_at timestamp [default: \`now()\`] indexes { (user_id, experiment_id) [pk] } }
Table cohorts { ${ID} project_id integer [not null] name varchar(120) [not null] definition json }
Ref: users.project_id > projects.id
Ref: sessions.user_id > users.id
Ref: events.session_id > sessions.id
Ref: events.user_id > users.id
Ref: funnels.project_id > projects.id
Ref: funnel_steps.funnel_id > funnels.id
Ref: experiments.project_id > projects.id
Ref: variants.experiment_id > experiments.id
Ref: assignments.user_id > users.id
Ref: assignments.experiment_id > experiments.id
Ref: assignments.variant_id > variants.id
Ref: cohorts.project_id > projects.id
`,
  },
  {
    id: "data-lineage-warehouse",
    name: "Data Warehouse Lineage",
    category: "Technology",
    description: "Raw → staging → marts pipeline drawn with Dep lineage arrows.",
    tags: ["dbt", "lineage", "warehouse", "etl"],
    dbml: `Table raw_orders { id integer [pk] customer_id integer amount decimal status varchar created_at timestamp }
Table raw_customers { id integer [pk] name varchar country varchar }
Table raw_payments { id integer [pk] order_id integer method varchar amount decimal }

Table stg_orders { order_id integer [pk] customer_id integer amount decimal status varchar ordered_at timestamp }
Table stg_customers { customer_id integer [pk] name varchar country varchar }
Table stg_payments { payment_id integer [pk] order_id integer method varchar amount decimal }

Table fct_orders { order_id integer [pk] customer_id integer revenue decimal paid boolean ordered_at timestamp }
Table dim_customers { customer_id integer [pk] name varchar country varchar lifetime_value decimal }
Table mart_revenue { month date [pk] revenue decimal orders integer }

Dep: raw_orders -> stg_orders [note: 'Clean and rename']
Dep: raw_customers -> stg_customers
Dep: raw_payments -> stg_payments
Dep {
  stg_orders.order_id -> fct_orders.order_id
  stg_orders.customer_id -> fct_orders.customer_id
  stg_orders.amount -> fct_orders.revenue
  stg_orders.ordered_at -> fct_orders.ordered_at
  note: 'Orders fact — keeps paid orders only'
}
Dep: stg_payments.amount -> fct_orders.revenue
Dep: stg_customers -> dim_customers
Dep: fct_orders.revenue -> dim_customers.lifetime_value
Dep {
  fct_orders.ordered_at -> mart_revenue.month
  fct_orders.revenue -> mart_revenue.revenue
  fct_orders.order_id -> mart_revenue.orders
  note: 'Monthly rollup'
  color: #F59E0B
}

TableGroup raw [color: #F87171] { raw_orders raw_customers raw_payments }
TableGroup staging [color: #F59E0B] { stg_orders stg_customers stg_payments }
TableGroup marts [color: #10B981] { fct_orders dim_customers mart_revenue }
`,
  },
  {
    id: "starter-blank",
    name: "Blank canvas with starter tables",
    category: "Business",
    description: "A minimal users / posts schema to start experimenting.",
    tags: ["starter", "minimal"],
    dbml: `Table users {
  ${ID}
  email varchar(255) [unique, not null]
  ${TS}
}

Table posts {
  ${ID}
  user_id integer [not null]
  title varchar(255) [not null]
  body text
  ${TS}
}

Ref: posts.user_id > users.id
`,
  },
];

export function getTemplate(id: string): DiagramTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function searchTemplates(query: string, category?: string): DiagramTemplate[] {
  const q = query.trim().toLowerCase();
  return TEMPLATES.filter((t) => (!category || category === "All" || t.category === category) && (!q || `${t.name} ${t.description} ${t.tags.join(" ")}`.toLowerCase().includes(q)));
}
