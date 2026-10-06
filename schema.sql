-- ============================================================================
-- schema.sql — Cloudflare D1 (SQLite) schema cho dự án E-commerce
-- Chạy local:  wrangler d1 execute ecommerce-db --local  --file=./schema.sql
-- Chạy remote: wrangler d1 execute ecommerce-db --remote --file=./schema.sql
-- ============================================================================

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
  ('Bàn phím cơ Akko 3068B', 'Bàn phím cơ 68 phím, hotswap, kết nối Bluetooth 5.0', 890000, 25, NULL, (SELECT id FROM categories WHERE name = 'Bàn phím')),
  ('Chuột không dây Logitech M650', 'Chuột không dây êm ái, pin 24 tháng', 450000, 40, NULL, (SELECT id FROM categories WHERE name = 'Chuột')),
  ('Tai nghe Sony WH-1000XM4', 'Tai nghe chống ồn chủ động, âm thanh Hi-Res', 5990000, 10, NULL, (SELECT id FROM categories WHERE name = 'Tai nghe')),
  ('Màn hình LG 27 inch 2K', 'Màn hình IPS 2560x1440, 75Hz, viền mỏng', 4290000, 15, NULL, (SELECT id FROM categories WHERE name = 'Màn hình')),
  ('Màn hình LG UltraGear 27GR75Q-B 27 inch 2K 165Hz','Màn hình gaming 27 inch QHD IPS 165Hz.',5490000,20,'https://www.lg.com/content/dam/channel/wcms/vn/images/man-hinh-may-tinh/md07560036/gallery/medium01.jpg', (SELECT id FROM categories WHERE name = 'Màn hình')),
  ('Màn hình Samsung Odyssey G5 27 inch QHD 165Hz','Màn hình gaming Samsung Odyssey G5 QHD.',5790000,18,'https://images.samsung.com/is/image/samsung/p6pim/vn/ls27cg552eexxv/gallery/vn-odyssey-g5-g55c-ls27cg552eexxv-537168934?$650_519_PNG$', (SELECT id FROM categories WHERE name = 'Màn hình')),
  ('Màn hình Dell S2722DGM 27 inch QHD 165Hz','Màn hình Dell 27 inch QHD dành cho gaming.',6490000,12,'https://i.dell.com/is/image/DellContent/content/dam/ss2/product-images/peripherals/output-devices/dell/monitors/s-series/s2722dgm/media-gallery/monitor-s2722dgm-gallery-1.psd?fmt=png-alpha', (SELECT id FROM categories WHERE name = 'Màn hình')),
  ('Màn hình ASUS TUF Gaming VG249Q3A 24 inch 180Hz','Màn hình ASUS TUF Gaming Full HD 180Hz.',3990000,25,'https://dlcdnwebimgs.asus.com/gain/0D8D47D3-14D0-4E17-94D7-AE013B86FDCB/w717/h525', (SELECT id FROM categories WHERE name = 'Màn hình')),
  ('Bàn phím Logitech MX Keys S','Bàn phím không dây Logitech dành cho công việc.',2690000,30,'https://resource.logitech.com/content/dam/logitech/en/products/keyboards/mx-keys-s/product-gallery/graphite/mx-keys-s-keyboard-top-view-graphite.png', (SELECT id FROM categories WHERE name = 'Bàn phím')),
  ('Bàn phím Logitech K380 Bluetooth','Bàn phím Bluetooth nhỏ gọn.',790000,40,'https://resource.logitech.com/content/dam/logitech/en/products/keyboards/k380/gallery/k380-gallery-1-blue.png', (SELECT id FROM categories WHERE name = 'Bàn phím')),
  ('Bàn phím Logitech G515 Lightspeed TKL','Bàn phím gaming không dây TKL.',3290000,15,'https://resource.logitech.com/content/dam/gaming/en/products/g515-lightspeed-tkl/gallery/g515-lightspeed-tkl-black-gallery-1.png', (SELECT id FROM categories WHERE name = 'Bàn phím')),
  ('Bàn phím ASUS ROG Strix Scope II 96 Wireless','Bàn phím gaming không dây layout 96%.',4190000,10,'https://dlcdnwebimgs.asus.com/gain/2F906486-7A99-48E6-A7EA-CA1567504359/w717/h525', (SELECT id FROM categories WHERE name = 'Bàn phím')),
  ('Chuột Logitech MX Master 3S','Chuột không dây cao cấp Logitech MX Master 3S.',2490000,35,'https://resource.logitech.com/content/dam/logitech/en/products/mice/mx-master-3s/gallery/mx-master-3s-top-view-black.png', (SELECT id FROM categories WHERE name = 'Chuột')),
  ('Chuột Logitech G502 X','Chuột gaming Logitech G502 X.',1490000,28,'https://resource.logitech.com/content/dam/gaming/en/products/g502-x/gallery/g502-x-black-gallery-1.png', (SELECT id FROM categories WHERE name = 'Chuột')),
  ('Chuột Logitech G304 Lightspeed','Chuột gaming không dây Logitech G304.',790000,50,'https://resource.logitech.com/content/dam/gaming/en/products/g305/g305-gallery-1.png', (SELECT id FROM categories WHERE name = 'Chuột')),
  ('Chuột ASUS ROG Harpe Ace Aim Lab Edition','Chuột gaming không dây trọng lượng nhẹ.',2490000,16,'https://dlcdnwebimgs.asus.com/gain/0903B3F7-B69C-4165-83B2-67DF310BA5A0/w717/h525', (SELECT id FROM categories WHERE name = 'Chuột')),
  ('PC Gaming Intel Core i5 14400F RTX 4060 16GB','PC gaming Intel Core i5-14400F, RAM 16GB, RTX 4060.',18990000,8,'https://nguyencongpc.vn/media/product/27841-pc-gaming-i5-14400f-ram-16gb-rgb-rtx-5060-8gb-001.jpg', (SELECT id FROM categories WHERE name = 'PC Gaming')),
  ('PC Gaming AMD Ryzen 5 7600 RTX 4060 Ti 16GB','PC gaming Ryzen 5 7600, RAM 16GB, RTX 4060 Ti.',23990000,6,'https://nguyencongpc.vn/media/product/27841-pc-gaming-i5-14400f-ram-16gb-rgb-rtx-5060-8gb-001.jpg', (SELECT id FROM categories WHERE name = 'PC Gaming')),
  ('PC Gaming Intel Core i7 14700F RTX 4070 Super 32GB','PC gaming Intel Core i7-14700F, RAM 32GB, RTX 4070 Super.',39990000,5,'https://nguyencongpc.vn/media/product/27841-pc-gaming-i5-14400f-ram-16gb-rgb-rtx-5060-8gb-001.jpg', (SELECT id FROM categories WHERE name = 'PC Gaming'));
