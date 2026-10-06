-- ============================================================================
-- schema.sql — Cloudflare D1 (SQLite) schema cho dự án E-commerce
-- Chạy local:  wrangler d1 execute ecommerce-db --local  --file=./schema.sql
-- Chạy remote: wrangler d1 execute ecommerce-db --remote --file=./schema.sql
-- ============================================================================

DROP TABLE IF EXISTS product_images;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;

-- ----------------------------------------------------------------------------
-- categories: danh mục sản phẩm
-- ----------------------------------------------------------------------------
CREATE TABLE categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

-- ----------------------------------------------------------------------------
-- users: tài khoản khách hàng và quản trị viên
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_users_email ON users(email);

-- ----------------------------------------------------------------------------
-- Danh mục phù hợp với các sản phẩm mẫu bên dưới
-- ----------------------------------------------------------------------------
INSERT INTO categories (name) VALUES ('Bàn phím'), ('Chuột'), ('Tai nghe'), ('Màn hình'), ('PC Gaming');

-- ----------------------------------------------------------------------------
-- products: sản phẩm, ảnh lưu trên R2 (image_url trỏ tới /images/<key>)
-- ----------------------------------------------------------------------------
CREATE TABLE products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       REAL NOT NULL CHECK (price >= 0),
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url   TEXT,
  category_id INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE INDEX idx_products_created_at ON products(created_at);
CREATE INDEX idx_products_category_id ON products(category_id);

-- ----------------------------------------------------------------------------
-- product_images: ảnh sản phẩm do admin upload, phục vụ qua GET /images/<id>
-- (dùng thay R2 để không cần bật R2 trên tài khoản Cloudflare)
-- ----------------------------------------------------------------------------
CREATE TABLE product_images (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL,
  data         BLOB NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- orders: đơn hàng của user
-- ----------------------------------------------------------------------------
CREATE TABLE orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  total_price       REAL NOT NULL CHECK (total_price >= 0),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'completed', 'cancelled')),
  shipping_address  TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);

-- ----------------------------------------------------------------------------
-- order_items: chi tiết từng sản phẩm trong đơn hàng
-- ----------------------------------------------------------------------------
CREATE TABLE order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL,
  product_id  INTEGER NOT NULL,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  price       REAL NOT NULL CHECK (price >= 0),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);

-- ----------------------------------------------------------------------------
-- Dữ liệu mẫu (tuỳ chọn) — xoá phần này nếu không cần seed data
-- ----------------------------------------------------------------------------
INSERT INTO products (name, description, price, stock, image_url, category_id) VALUES
  ('Bàn phím cơ Akko 3068B', 'Bàn phím cơ 68 phím, hotswap, kết nối Bluetooth 5.0', 890000, 25, '/img/products/akko-3068b.webp', (SELECT id FROM categories WHERE name = 'Bàn phím')),
  ('Chuột không dây Logitech M650', 'Chuột không dây êm ái, pin 24 tháng', 450000, 40, '/img/products/logitech-m650.webp', (SELECT id FROM categories WHERE name = 'Chuột')),
  ('Tai nghe Sony WH-1000XM4', 'Tai nghe chống ồn chủ động, âm thanh Hi-Res', 5990000, 10, '/img/products/sony-wh-1000xm4.webp', (SELECT id FROM categories WHERE name = 'Tai nghe')),
  ('Màn hình LG 27 inch 2K', 'Màn hình IPS 2560x1440, 75Hz, viền mỏng', 4290000, 15, '/img/products/lg-27qn600.webp', (SELECT id FROM categories WHERE name = 'Màn hình')),
  ('Màn hình LG UltraGear 27GR75Q-B 27 inch 2K 165Hz','Màn hình gaming 27 inch QHD IPS 165Hz.',5490000,20,'/img/products/lg-27gr75q.webp', (SELECT id FROM categories WHERE name = 'Màn hình')),
  ('Màn hình Samsung Odyssey G5 27 inch QHD 165Hz','Màn hình gaming Samsung Odyssey G5 QHD.',5790000,18,'/img/products/samsung-odyssey-g5.webp', (SELECT id FROM categories WHERE name = 'Màn hình')),
  ('Màn hình Dell S2722DGM 27 inch QHD 165Hz','Màn hình Dell 27 inch QHD dành cho gaming.',6490000,12,'/img/products/dell-s2722dgm.webp', (SELECT id FROM categories WHERE name = 'Màn hình')),
  ('Màn hình ASUS TUF Gaming VG249Q3A 24 inch 180Hz','Màn hình ASUS TUF Gaming Full HD 180Hz.',3990000,25,'/img/products/asus-vg249q3a.webp', (SELECT id FROM categories WHERE name = 'Màn hình')),
  ('Bàn phím Logitech MX Keys S','Bàn phím không dây Logitech dành cho công việc.',2690000,30,'/img/products/logitech-mx-keys-s.webp', (SELECT id FROM categories WHERE name = 'Bàn phím')),
  ('Bàn phím Logitech K380 Bluetooth','Bàn phím Bluetooth nhỏ gọn.',790000,40,'/img/products/logitech-k380.webp', (SELECT id FROM categories WHERE name = 'Bàn phím')),
  ('Bàn phím Logitech G515 Lightspeed TKL','Bàn phím gaming không dây TKL.',3290000,15,'/img/products/logitech-g515.webp', (SELECT id FROM categories WHERE name = 'Bàn phím')),
  ('Bàn phím ASUS ROG Strix Scope II 96 Wireless','Bàn phím gaming không dây layout 96%.',4190000,10,'/img/products/asus-rog-scope-ii-96.webp', (SELECT id FROM categories WHERE name = 'Bàn phím')),
  ('Chuột Logitech MX Master 3S','Chuột không dây cao cấp Logitech MX Master 3S.',2490000,35,'/img/products/logitech-mx-master-3s.webp', (SELECT id FROM categories WHERE name = 'Chuột')),
  ('Chuột Logitech G502 X','Chuột gaming Logitech G502 X.',1490000,28,'/img/products/logitech-g502-x.webp', (SELECT id FROM categories WHERE name = 'Chuột')),
  ('Chuột Logitech G304 Lightspeed','Chuột gaming không dây Logitech G304.',790000,50,'/img/products/logitech-g304.webp', (SELECT id FROM categories WHERE name = 'Chuột')),
  ('Chuột ASUS ROG Harpe Ace Aim Lab Edition','Chuột gaming không dây trọng lượng nhẹ.',2490000,16,'/img/products/asus-rog-harpe-ace.webp', (SELECT id FROM categories WHERE name = 'Chuột')),
  ('PC Gaming Intel Core i5 14400F RTX 4060 16GB','PC gaming Intel Core i5-14400F, RAM 16GB, RTX 4060.',18990000,8,'/img/products/pc-i5-14400f-rtx4060.webp', (SELECT id FROM categories WHERE name = 'PC Gaming')),
  ('PC Gaming AMD Ryzen 5 7600 RTX 4060 Ti 16GB','PC gaming Ryzen 5 7600, RAM 16GB, RTX 4060 Ti.',23990000,6,'/img/products/pc-r5-7600-rtx4060ti.webp', (SELECT id FROM categories WHERE name = 'PC Gaming')),
  ('PC Gaming Intel Core i7 14700F RTX 4070 Super 32GB','PC gaming Intel Core i7-14700F, RAM 32GB, RTX 4070 Super.',39990000,5,'/img/products/pc-i7-14700f-rtx4070s.webp', (SELECT id FROM categories WHERE name = 'PC Gaming'));
