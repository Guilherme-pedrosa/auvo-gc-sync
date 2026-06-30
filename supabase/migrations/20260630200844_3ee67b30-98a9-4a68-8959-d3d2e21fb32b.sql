
WITH norm AS (
  SELECT id, lower(translate(coalesce(nome,''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) AS n
  FROM equipamentos_auvo
  WHERE status='Ativo' AND tipo_id IS NULL
),
tipos_exp AS (
  SELECT t.id AS tipo_id,
    lower(translate(unnest(t.palavras_chave),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) AS kw,
    CASE t.periodicidade WHEN 'MENSAL' THEN 1 WHEN 'BIMESTRAL' THEN 2 WHEN 'TRIMESTRAL' THEN 3 WHEN 'SEMESTRAL' THEN 4 ELSE 5 END AS prio
  FROM tipos_equipamento t WHERE t.ativo
),
matches AS (
  SELECT n.id, te.tipo_id,
    ROW_NUMBER() OVER (PARTITION BY n.id ORDER BY te.prio, length(te.kw) DESC) AS rn
  FROM norm n
  JOIN tipos_exp te ON n.n LIKE '%' || te.kw || '%'
)
UPDATE equipamentos_auvo e
SET tipo_id = m.tipo_id
FROM matches m
WHERE m.rn = 1 AND e.id = m.id;
