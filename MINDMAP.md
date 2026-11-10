# Storefront roadmap mind map

The current storefront is a browser-local demo. Every future phase below is **not started** and requires owner review; see [ROADMAP.md](ROADMAP.md) for decisions, dependencies and acceptance criteria.

```mermaid
mindmap
  root((GreenCart storefront))
    Current local demo
      Static storefront
      Browser-local admin and orders
      Simulated payments and refunds
    0 Design approval
      Business and privacy decisions
      Architecture and migration plan
    1 Data and security
      Supabase Postgres and migrations
      Authentication and team roles
      Row Level Security and tests
    2 Secure actions
      Product variants and stock
      Order state and audit trail
      Verified payments and refunds
    3 Admin lists
      Responsive shell
      Search pagination filters
      Low-stock and order status
    4 Details and forms
      Variant matrix and validation
      Tracking and packing slips
      Customer references and promotions
    5 Analytics and operations
      Revenue order count and AOV
      Sales trends and stock alerts
      Monitoring backups and recovery
    6 Launch
      Security accessibility and tests
      Staging and rollback rehearsal
      Owner go or no-go approval
```

The main dependency path is **design → schema and authorization → secure actions → admin lists → detail forms → analytics → launch**. Some design and operational preparation can happen earlier, but no phase should be treated as approved or complete by default.
