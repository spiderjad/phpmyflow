<?php
declare(strict_types=1);

use PhpMyFlow\Privileges;

return [
    'root: ALL on *.* covers everything' => static function (): void {
        $p = Privileges::parse(["GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` IDENTIFIED BY PASSWORD '*81F5E2' WITH GRANT OPTION", 'GRANT PROXY ON \'\'@\'%\' TO \'root\'@\'localhost\' WITH GRANT OPTION'], "'root'@'localhost'");
        eq(true, $p->has('DROP', 'shop'));
        eq(true, $p->has('CREATE', null));
        eq(true, $p->has('SELECT', 'shop', 'orders'));
    },
    'read-only demo user: SELECT and SHOW VIEW on one database' => static function (): void {
        $p = Privileges::parse(['GRANT USAGE ON *.* TO `demo`@`%`', 'GRANT SELECT, SHOW VIEW ON `shop`.* TO `demo`@`%`'], "'demo'@'%'");
        eq(true, $p->has('SELECT', 'shop'));
        eq(true, $p->has('SHOW VIEW', 'shop'));
        eq(false, $p->has('DROP', 'shop'));
        eq(false, $p->has('SELECT', 'other'));
        eq(false, $p->has('CREATE', null));
        eq("GRANT DROP ON `shop`.* TO 'demo'@'%';", $p->grant('DROP', 'shop'));
        eq("GRANT CREATE ON *.* TO 'demo'@'%';", $p->grant('CREATE', null));
    },
    'database wildcards follow LIKE, with \_ as a literal underscore' => static function (): void {
        $p = Privileges::parse(['GRANT ALL PRIVILEGES ON `app\_%`.* TO `u`@`%`', 'GRANT SELECT ON `t_st`.* TO `u`@`%`'], "'u'@'%'");
        eq(true, $p->has('DROP', 'app_prod'));
        eq(false, $p->has('DROP', 'appxprod'));
        eq(true, $p->has('SELECT', 'test'));
        eq(true, $p->has('SELECT', 't_st'));
        eq(false, $p->has('CREATE', null));
        eq(true, $p->canCreateSomeDatabase());
    },
    'table-level grants count for that table only; column grants do not' => static function (): void {
        $p = Privileges::parse(['GRANT SELECT, INSERT ON `shop`.`orders` TO `u`@`%`', 'GRANT SELECT (`id`, `name`), UPDATE (`name`) ON `shop`.`customers` TO `u`@`%`'], "'u'@'%'");
        eq(true, $p->has('INSERT', 'shop', 'orders'));
        eq(false, $p->has('INSERT', 'shop', 'products'));
        eq(false, $p->has('SELECT', 'shop'));
        eq(false, $p->has('SELECT', 'shop', 'customers'));
    },
    'roles make the answer unknown (null) instead of a wrong "no"' => static function (): void {
        $p = Privileges::parse(['GRANT USAGE ON *.* TO `u`@`%`', 'GRANT `app_writer`@`%` TO `u`@`%`'], "'u'@'%'");
        eq(null, $p->has('DROP', 'shop'));
        $q = Privileges::parse(['GRANT `reporting` TO `u`@`%`', 'GRANT SELECT ON `shop`.* TO `u`@`%`'], "'u'@'%'");
        eq(true, $q->has('SELECT', 'shop'));
        eq(null, $q->has('DELETE', 'shop'));
    },
];
