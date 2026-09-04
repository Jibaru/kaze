```yaml
scenario: url-shortener
revision: 1
groups:
  - { id: vpc,  kind: vpc, cidr: 10.0.0.0/16 }
  - { id: az-a, kind: az,  parent: vpc }
nodes:
  - { id: n1, service: CloudFront, label: CDN }
  - { id: n2, service: ApplicationLoadBalancer, group: vpc }
  - { id: n3, service: ECS, label: shortener-api, group: az-a }
  - { id: n5, service: RDS, label: links-db, group: az-a, props: { engine: postgres } }
edges:
  - { from: n1, to: n2, protocol: HTTPS }
  - { from: n2, to: n3 }
  - { from: n3, to: n5, protocol: TCP/5432 }
gaps:
  - untyped_edge: "n2 -> n3 has no protocol"
  - single_az: "n5 (RDS) sits in one AZ group with no multi_az prop"
  - no_backup: "n5 has no backup or retention prop"
```
