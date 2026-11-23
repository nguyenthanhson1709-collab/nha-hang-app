-- Danh mục nhóm hàng đề xuất (SKR03). Hàng hoá: tài khoản theo mức thuế (3300 = 7%, 3400 = 19%).
with top as (
  insert into public.nh_categories(kind, name_vi, name_de, skr_account, sort) values
   ('food','Thực phẩm','Lebensmittel',null,1),
   ('drink','Đồ uống','Getränke',null,2),
   ('nonfood','Nonfood','Non-Food',null,3)
  returning id, kind
)
insert into public.nh_categories(parent_id, kind, name_vi, name_de, skr_account, sort)
select t.id, t.kind, c.vi, c.de, c.acc, c.s from top t join (values
 ('food','Đồ khô','Trockenware',null,1),
 ('food','Rau, củ, quả','Obst und Gemüse',null,2),
 ('food','Thịt','Fleisch',null,3),
 ('food','Hải sản','Fisch und Meeresfrüchte',null,4),
 ('food','Trứng, sữa','Eier und Milchprodukte',null,5),
 ('food','Gia vị','Gewürze und Saucen',null,6),
 ('food','Đồ đông lạnh','Tiefkühlware',null,7),
 ('food','Khác','Sonstige Lebensmittel',null,9),
 ('drink','Rượu','Wein und Spirituosen',null,1),
 ('drink','Bia','Bier',null,2),
 ('drink','Nước lọc','Wasser',null,3),
 ('drink','Nước ngọt','Softdrinks und Säfte',null,4),
 ('drink','Khác','Sonstige Getränke',null,9),
 ('nonfood','Bao bì, đồ dùng một lần','Verpackung und Einwegartikel','4710',1),
 ('nonfood','Vệ sinh, hoá chất','Reinigung','4250',2),
 ('nonfood','Gas, nhiên liệu','Gas und Brennstoffe','4240',3),
 ('nonfood','Dụng cụ bếp','Werkzeuge und Kleingeräte','4985',4),
 ('nonfood','Khác','Sonstiger Betriebsbedarf','4980',9)
) as c(kind, vi, de, acc, s) on c.kind = t.kind;

-- Chủ: tài khoản hiện có của anh/chị trong project này
insert into public.nh_profiles(id, email, full_name, is_owner)
select id, email, split_part(email,'@',1), true from auth.users where email = (select email from auth.users order by created_at limit 1) -- tài khoản sẵn có của chủ
on conflict (id) do update set is_owner = true;
