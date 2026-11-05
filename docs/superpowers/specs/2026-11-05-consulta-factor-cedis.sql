-- Revisión de la columna "factor" (piezas por empaque) en el SICAR de CEDIS.
-- SOLO LECTURA: estas consultas no cambian nada en SICAR.
-- Cómo correrla: en la PC de CEDIS, abrir la base de SICAR con el programa de MySQL que usen
-- (HeidiSQL, MySQL Workbench o la consola `mysql`), seleccionar la base de SICAR y ejecutar todo.
-- Mándale a Claude el resultado de las 4 consultas (captura o texto).

-- 1) ¿Existe la columna y de qué tipo es?
--    Bien: Type = decimal(...)  → el agente la recibe como texto exacto.
--    Problema: int, double, float → llega como número y el agente se salta la compra.
--    Si no sale ninguna fila: la columna no existe y el agente usa 1 pieza por empaque (está bien).
SHOW COLUMNS FROM `detallec` LIKE 'factor';

-- 2) ¿Cuántos renglones se saltaría el agente? (todo el historial)
--    Todo debe salir en 0 menos "total" y "distinto_de_uno".
SELECT
  COUNT(*)                                                  AS total,
  SUM(`factor` IS NULL)                                     AS vacios,
  SUM(`factor` <= 0)                                        AS cero_o_negativo,
  SUM(`factor` * 10000 <> FLOOR(`factor` * 10000))          AS mas_de_4_decimales,
  SUM(`factor` <> 1)                                        AS distinto_de_uno
FROM `detallec`;

-- 3) Lo mismo, solo compras de los últimos 12 meses (las que el agente va a mandar primero).
SELECT
  COUNT(*)                                                  AS total,
  SUM(d.`factor` IS NULL)                                   AS vacios,
  SUM(d.`factor` <= 0)                                      AS cero_o_negativo,
  SUM(d.`factor` * 10000 <> FLOOR(d.`factor` * 10000))      AS mas_de_4_decimales,
  SUM(d.`factor` <> 1)                                      AS distinto_de_uno
FROM `detallec` d
JOIN `compra` c ON c.`com_id` = d.`com_id`
WHERE c.`fecha` >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH);

-- 4) Los valores que de verdad aparecen (los 30 más usados).
SELECT `factor`, COUNT(*) AS renglones
FROM `detallec`
GROUP BY `factor`
ORDER BY renglones DESC
LIMIT 30;
