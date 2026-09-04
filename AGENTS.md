# Agent boundary

This repository owns the National Garden Water decision tool only.

It may change:
- `/national-tools/garden-water/`
- `/api/national-garden-water`
- garden-water assets, crop profiles, water-balance logic, tests and benchmarks.

It must not copy sibling tool implementations. Shared location helpers remain in `izworskic/national-outdoor-core` and are consumed through the existing HTTP contract. The National Outdoor Tools hub owns discovery/orchestration. The main `chrisizworski-com` repository owns canonical composition/routing.

Never claim measured soil moisture unless supplied by a sensor or gardener observation. Never turn precipitation probability into rainfall depth. Never ignore gardener-entered irrigation or rain-gauge data.
