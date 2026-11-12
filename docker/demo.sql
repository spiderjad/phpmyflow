-- Sample "shop" data for the public demo on shared hosting: docker/sample.sql
-- without CREATE DATABASE, USE, CREATE USER and GRANT (a hosting account can't
-- run them). Import it into the empty demo database (phpMyAdmin → Import), or
-- let scripts/demo-reset.php load it. tests/php/DemoTest.php keeps both files in sync.
SET NAMES utf8mb4;

CREATE TABLE customers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  country CHAR(2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) COMMENT 'People who buy';

CREATE TABLE products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(60) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  status ENUM('pending','paid','shipped','cancelled') NOT NULL DEFAULT 'pending',
  ordered_at DATETIME NOT NULL,
  notes TEXT NULL,
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE order_items (
  order_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (order_id, product_id),
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products(id)
);

INSERT INTO customers (name, email, country, created_at) VALUES
 ('Lucía Fernández','lucia@example.com','ES','2026-01-12 10:00:00'),
 ('Marco Rossi','marco@example.com','IT','2026-02-03 16:20:00'),
 ('Camille Dubois','camille@example.com','FR','2026-02-18 09:45:00'),
 ('John Carter','john@example.com','US','2026-03-01 12:00:00'),
 ('Martina Gómez','martina@example.com','AR','2026-03-22 18:30:00');

INSERT INTO products (sku, name, category, price, stock) VALUES
 ('KB-01','Mechanical keyboard','Peripherals',89.90,40),
 ('MS-02','Wireless mouse','Peripherals',29.50,120),
 ('MN-27','27" monitor','Displays',249.00,15),
 ('HD-01','Noise-cancelling headphones','Audio',179.00,25),
 ('CB-10','USB-C cable 1m','Accessories',9.90,500);

INSERT INTO orders (customer_id, status, ordered_at, notes) VALUES
 (1,'paid','2026-04-01 11:00:00',NULL),
 (2,'shipped','2026-04-03 15:10:00','Leave at reception'),
 (3,'pending','2026-04-05 08:00:00',NULL),
 (1,'shipped','2026-04-09 19:40:00',NULL),
 (5,'cancelled','2026-04-11 13:15:00','Customer changed mind');

INSERT INTO order_items VALUES
 (1,1,1,89.90),(1,2,1,29.50),(2,3,2,249.00),(3,5,3,9.90),
 (4,4,1,179.00),(4,5,2,9.90),(5,2,1,29.50);

-- Two tables WITHOUT foreign keys: they relate by naming convention only
-- (like GLPI or WordPress). phpMyFlow infers these relations.
CREATE TABLE reviews (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id INT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NULL,
  rating TINYINT NOT NULL,
  comment TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_notes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  orders_id INT UNSIGNED NOT NULL,
  note VARCHAR(255) NOT NULL,
  uuid CHAR(36) NULL,
  paid TINYINT NOT NULL DEFAULT 0
);

INSERT INTO reviews (product_id, customer_id, rating, comment, created_at) VALUES
 (1,1,5,'Great keyboard','2026-04-05 10:00:00'),
 (2,2,4,NULL,'2026-04-06 12:30:00'),
 (1,3,3,'Keys are a bit loud','2026-04-08 09:15:00');

INSERT INTO order_notes (orders_id, note, uuid, paid) VALUES
 (1,'Gift wrap',NULL,1),
 (2,'Call before delivery',NULL,0),
 (2,'Second attempt',NULL,0);

-- Polymorphic pair (like GLPI itemtype + items_id): items_id points to a
-- different table on each row, so it is never inferred as a foreign key.
CREATE TABLE activity_log (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  itemtype VARCHAR(40) NOT NULL,
  items_id INT UNSIGNED NOT NULL,
  action VARCHAR(40) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY item (itemtype, items_id)
);

INSERT INTO activity_log (itemtype, items_id, action, created_at) VALUES
 ('Product',1,'price_changed','2026-04-02 10:00:00'),
 ('Order',2,'shipped','2026-04-09 19:40:00'),
 ('Customer',3,'email_changed','2026-04-10 08:20:00');

-- Spanish prefix-style relations WITHOUT foreign keys (id_planta, id_departamento):
-- the inference must find them, and the UI must show names and record pickers.
-- Verified behaviors in CLAUDE.md rely on this data (Mantenimiento = 3).
CREATE TABLE plantas (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL
);

CREATE TABLE departamentos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL,
  id_planta INT UNSIGNED NULL
);

CREATE TABLE catalogo (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  id_departamento INT UNSIGNED NULL
);

INSERT INTO plantas VALUES (1,'Planta Norte'),(2,'Planta Sur');
INSERT INTO departamentos VALUES (1,'Producción',1),(2,'Calidad',1),(3,'Mantenimiento',2),(4,'Logística',2);
INSERT INTO catalogo (name, is_active, sort_order, id_departamento) VALUES ('Tornillo M6',1,1,1),('Guante nitrilo',1,2,2);
