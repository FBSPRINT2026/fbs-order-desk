-- A Create order training's order defaults (Oct 31, Nick on MEI: "the default shipping is always FedEx Ground, unless he
-- says something different in the ClickUp or email… always set to reorder by default with no production confirmation").
-- { order_type, confirm, delivery_method, ship_method, set: [fields staff set], learned: { field: "#40311, #40314" } }
alter table order_trainings add column if not exists defaults jsonb not null default '{}'::jsonb;
