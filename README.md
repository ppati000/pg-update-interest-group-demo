# Interest Group: Exploring the Inner Workings of PostgreSQL UPDATE Operations

Ideas:
1. How `UPDATE` works
2. Updating rows concurrently
    1. Locking (show in two terminals)
    2. Performance with many processes
3. Updating many rows
    1. How to avoid locks
        1. `lock_timeout`
        2. `SELECT FOR UPDATE SKIP LOCKED`
    2. Deadlocks 💀
4. DDL statements 💣

Three key questions:

1. Is updating an existing row easier than inserting a new row?
2. Does the Read Committed isolation level imply that we might lose concurrent row updates?
3. Is updating many rows in one query better than updating one row at a time?

# 1 How `UPDATE` works

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

# 2 Concurrent UPDATE operations

Let's update the row in two terminals:

```sql
-- Terminal 1
BEGIN;
UPDATE person SET name = 'Pat' WHERE id = 1;

-- Terminal 2
BEGIN;
UPDATE person SET name = name || 'rick' WHERE id = 1;
```

## Excursion: Performance with many processes

See `insert_rows.ts` and `update_single_row.ts`.

# 3 Multi-row UPDATE queries

## Deadlocks

```sql
TRUNCATE TABLE person;
INSERT INTO person
  SELECT generate_series, true, 'foo'
  FROM generate_series(1, 1000);
```

```sql
-- Terminal 1
BEGIN;
UPDATE person SET name = 'Patrick' WHERE id <= 500;

-- Terminal 2
BEGIN;
UPDATE person SET name = 'Patrick' WHERE id > 500;

-- Terminal 1
UPDATE person SET name = 'Pat' WHERE id > 500;

-- Terminal 2
UPDATE person SET name = 'Pat' WHERE id <= 500;
```
