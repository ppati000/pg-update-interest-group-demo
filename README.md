# Interest Group: UPDATE statements in PostgreSQL

Postgres UPDATE statements
1. How `UPDATE` works
2. Updating rows concurrently
    1. Locking (show in two terminals)
    2. Performance with many processes
3. Updating many rows
    1. How to avoid locks
        1. `lock_timeout`
        2. `SELECT FOR UPDATE`
    2. Deadlocks 💀
4. DDL statements 💣

## 1 How `UPDATE` works

First, some preparation.

```sql
CREATE EXTENSION IF NOT EXISTS pageinspect;

CREATE TABLE IF NOT EXISTS person (id int, is_cool bool, name text);
TRUNCATE TABLE person;

CREATE OR REPLACE FUNCTION get_page_human(relname text, pageno int) 
RETURNS TABLE (
    t_ctid tid, 
    t_infomask bit(16), 
    t_data bytea,
    t_xmin xid,
    t_xmax xid,
    xmin_committed bool,
    xmin_aborted bool,
    xmax_committed bool,
    xmax_aborted bool,
    is_updated bool
) AS $$ SELECT 
    t_ctid, 
    t_infomask::bit(16), 
    t_data, 
    t_xmin, 
    t_xmax, 
    (t_infomask & 256) > 0 AS xmin_committed, 
    (t_infomask & 512) > 0 AS xmin_aborted, 
    (t_infomask & 1024) > 0 AS xmax_committed, 
    (t_infomask & 2048) > 0 AS xmax_aborted, 
    (t_infomask & x'2000'::INT) > 0 AS is_updated  
FROM 
    heap_page_items(get_raw_page(relname, pageno));
$$ LANGUAGE SQL;
```

Insert a row:

```sql
INSERT INTO person VALUES (1, false, 'Patrick');
```

Now let's look at the page:

```sql
SELECT * FROM get_page_human('person', 0);
```

Pay attention to:
* `t_xmin` / `t_xmax`
* various flags

Now let's update the row:

```sql
UPDATE person SET is_cool = true WHERE id = 1;
SELECT * from person; -- Update hint bits.
```

...and look at the page again:

```sql
SELECT * FROM get_page_human('person', 0);
```

The now-invisible rows are eventually removed by `VACUUM`. 

```
VACUUM person;
SELECT * FROM get_page_human('person', 0);
```

Keeping old versions is necessary for transaction isolation.
This way a `SELECT` does not need to acquire a lock.

# 2 Updating rows concurrently

## 2.1 Updating a single row concurrently

Let's update the row in two terminals:

```sql
-- Terminal 1
BEGIN;
UPDATE person SET name = 'Pat' WHERE id = 1;

-- Terminal 2
BEGIN;
UPDATE person SET name = name || 'rick' WHERE id = 1;
```

Even at the read committed isolation level, these queries are safe in Postgres.
The second UPDATE will wait for the first transaction to finish, and then re-read the row.

## 2.2 Performance with many processes

See `insert_rows.ts` and `update_single_row.ts`.
