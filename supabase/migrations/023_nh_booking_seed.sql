-- 023: Dữ liệu ban đầu của module Đặt bàn cho Vietbowl Potsdamer Platz (= quán "Vietbowl Mitte GmbH" trong app):
-- cài đặt như app cũ (chưa nhận khách online: online_enabled = false cho tới khi chuyển trang khách),
-- 4 khu, 73 bàn theo bản vẽ quán, luật cao điểm mặc định. Chỉ nạp khi quán chưa có sơ đồ.
-- Khi chuyển dữ liệu từ app cũ, sơ đồ/luật/cài đặt sẽ được thay bằng bản đang chạy thật.
do $$
declare rid uuid;
begin
  select id into rid from public.nh_restaurants where name = 'Vietbowl Mitte GmbH' limit 1;
  if rid is null or exists (select 1 from public.nh_bk_tables where restaurant_id = rid) then return; end if;

  insert into public.nh_bk_settings (restaurant_id, slug, online_enabled, contact_email, google_review_url)
  values (rid, 'potsdamerplatz', false, 'potsdamerplatz@vietbowl.de', 'https://g.page/r/CQsWOvX-Ppp2EBM/review')
  on conflict (restaurant_id) do nothing;

  insert into public.nh_bk_areas (restaurant_id, id, name, sort) values
    (rid,'in','Innen',1),(rid,'fa','Terrasse Fassade',2),(rid,'re','Terrasse Reihe',3),(rid,'no','Terrasse Nord',4);

  insert into public.nh_bk_tables (restaurant_id, id, label, area_id, x, y, w, h, rot, seats, flip)
  select rid, v.* from (values
  ('t51','51','in',360,609,50,40,0,2,false),
  ('t52','52','in',475,609,50,40,0,2,false),
  ('t53','53','in',636,627,48,84,0,4,false),
  ('t54','54','in',810,627,48,84,0,4,false),
  ('t41','41','in',540,752,50,58,0,2,false),
  ('t42','42','in',595,752,50,58,0,2,false),
  ('t43','43','in',650,752,50,58,0,2,false),
  ('t44','44','in',705,752,50,58,0,2,false),
  ('t45','45','in',760,752,50,58,0,2,false),
  ('t46','46','in',862,741,50,58,0,2,false),
  ('t47','47','in',916,741,50,58,0,2,false),
  ('t31','31','in',540,873,50,58,0,2,false),
  ('t32','32','in',595,873,50,58,0,2,false),
  ('t33','33','in',650,873,50,58,0,2,false),
  ('t34','34','in',705,873,50,58,0,2,false),
  ('t35','35','in',760,873,50,58,0,2,false),
  ('t36','36','in',815,873,50,58,0,2,false),
  ('t37','37','in',870,873,50,58,0,2,false),
  ('t21','21','in',540,1004,50,58,0,2,false),
  ('t22','22','in',595,1004,50,58,0,2,false),
  ('t23','23','in',650,1004,50,58,0,2,false),
  ('t24','24','in',705,1004,50,58,0,2,false),
  ('t9','9','in',566,1192,52,50,-40,2,false),
  ('t10','10','in',611,1154,52,50,-40,2,false),
  ('t11','11','in',656,1116,52,50,-40,2,false),
  ('t12','12','in',782,1054,66,48,-40,2,false),
  ('t13','13','in',909,933,62,50,-38,4,false),
  ('t63','63','fa',999,973,70,58,54,3,false),
  ('t60','60','fa',1040,1029,70,58,54,3,true),
  ('t73','73','fa',839,1099,70,58,55,3,false),
  ('t70','70','fa',879,1157,70,58,55,3,true),
  ('t83','83','fa',732,1190,70,58,55,3,false),
  ('t80','80','fa',772,1248,70,58,55,3,true),
  ('t93','93','fa',615,1278,70,58,55,3,false),
  ('t90','90','fa',655,1336,70,58,55,3,true),
  ('t103','103','fa',482,1388,70,58,54,3,false),
  ('t100','100','fa',523,1444,70,58,54,3,true),
  ('t113','113','fa',376,1475,70,58,55,3,false),
  ('t110','110','fa',416,1533,70,58,55,3,true),
  ('t200','200','re',1191,1168,70,58,54,3,false),
  ('t203','203','re',1232,1225,70,58,54,3,true),
  ('t210','210','re',1092,1247,70,58,54,3,false),
  ('t213','213','re',1133,1303,70,58,54,3,true),
  ('t220','220','re',999,1317,70,58,55,3,false),
  ('t223','223','re',1039,1375,70,58,55,3,true),
  ('t230','230','re',905,1390,70,58,55,3,false),
  ('t233','233','re',945,1448,70,58,55,3,true),
  ('t240','240','re',812,1465,70,58,55,3,false),
  ('t243','243','re',852,1523,70,58,55,3,true),
  ('t250','250','re',713,1539,70,58,55,3,false),
  ('t253','253','re',753,1597,70,58,55,3,true),
  ('t260','260','re',612,1608,70,58,55,3,false),
  ('t263','263','re',652,1666,70,58,55,3,true),
  ('t270','270','re',513,1687,70,58,55,3,false),
  ('t273','273','re',553,1745,70,58,55,3,true),
  ('t280','280','re',410,1763,70,58,55,3,false),
  ('t283','283','re',450,1821,70,58,55,3,true),
  ('t290','290','re',311,1838,70,58,55,3,false),
  ('t293','293','re',351,1896,70,58,55,3,true),
  ('t363','363','no',752,104,64,46,-1,3,false),
  ('t360','360','no',815,103,64,46,-1,3,true),
  ('t353','353','no',764,224,64,46,-2,3,false),
  ('t350','350','no',828,222,64,46,-2,3,true),
  ('t343','343','no',878,379,64,46,-1,3,false),
  ('t340','340','no',942,378,64,46,-1,3,true),
  ('t333','333','no',876,505,64,46,-1,3,false),
  ('t330','330','no',940,504,64,46,-1,3,true),
  ('t320','320','no',1060,589,64,46,-17,3,false),
  ('t323','323','no',1122,571,64,46,-17,3,true),
  ('t310','310','no',1104,709,64,46,-17,3,false),
  ('t313','313','no',1166,691,64,46,-17,3,true),
  ('t300','300','no',1149,829,64,46,-17,3,false),
  ('t303','303','no',1211,811,64,46,-17,3,true)
  ) as v(id, label, area_id, x, y, w, h, rot, seats, flip);

  insert into public.nh_bk_peak_rules (restaurant_id, days, start_time, end_time, max_guests, block_min) values
    (rid, '{1,2,3,4,5}', '14:00', '22:00', 35, 30),
    (rid, '{6,0}', '11:30', '22:00', 35, 30);
end $$;
