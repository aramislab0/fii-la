-- Audit du 20/10/2026 (conseiller de performance Supabase) : index sur les clés étrangères qui n'en avaient pas.
-- Sans eux, chaque suppression d'une ligne parente (boutique, compte, commande…) parcourt toute la table enfant.
create index if not exists admin_log_user on fiila.admin_log (user_id);
create index if not exists comments_user on fiila.comments (user_id);
create index if not exists couriers_user on fiila.couriers (user_id);
create index if not exists customers_place on fiila.customers (place_id);
create index if not exists orders_customer on fiila.orders (customer_id);
create index if not exists orders_place on fiila.orders (place_id);
create index if not exists posts_shop on fiila.posts (shop_id);
create index if not exists requests_place on fiila.requests (place_id);
create index if not exists shop_invites_created_by on fiila.shop_invites (created_by);
create index if not exists shop_invites_used_by on fiila.shop_invites (used_by);
create index if not exists shop_members_invited_by on fiila.shop_members (invited_by);
create index if not exists shops_courier on fiila.shops (courier_id);
create index if not exists staff_added_by on fiila.staff (added_by);
create index if not exists staff_invites_invited_by on fiila.staff_invites (invited_by);
create index if not exists staff_invites_used_by on fiila.staff_invites (used_by);
create index if not exists trackers_order on fiila.trackers (order_id);
create index if not exists trackers_request on fiila.trackers (request_id);
create index if not exists vd_submissions_product on fiila.vd_submissions (product_id);
