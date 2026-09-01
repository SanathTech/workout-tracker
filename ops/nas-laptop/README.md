# Deployed copies of the nas-laptop fitness sync

Source of truth for `/srv/fitness/intervals-sync.py` and `/srv/fitness/streams.py`,
which run on nas-laptop (192.168.1.227) under `fitness-sync.timer` and write the hub
tables this repo's backend reads. They lived only on that box through three revisions
of `streams.py` — an un-versioned data pipeline feeding a versioned app is how a
quiet regression becomes untraceable.

Deploy = `scp ops/nas-laptop/*.py sanath@192.168.1.227:/srv/fitness/` then
`python -m py_compile` there. Config stays in `/srv/fitness/fitness.env` (never here).
