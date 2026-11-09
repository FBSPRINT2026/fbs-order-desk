-- New orders start at 50,000 (Nov 9, Nick): orders made before keep their numbers
select setval('order_number_seq', greatest(49999, (select last_value from order_number_seq)), true);
