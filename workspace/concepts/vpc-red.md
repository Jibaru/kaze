---
id: vpc-red
title: VPC — subnets, NAT and what "put it in the VPC" costs
title_es: VPC — subredes, NAT y qué cuesta «meterlo en la VPC»
service: EC2
difficulty: 3
steps: 6
---

## What this is about

Where a box actually sits on the network, why "private subnet" is not a
security control on its own, and why attaching a function to a VPC is a
decision with a price.

## What must be understood by the end

1. **Public and private is a routing fact, not a setting.** A subnet is public
   because its route table sends the internet-bound traffic to an internet
   gateway. There is no "public" checkbox, and calling a subnet private while
   its route table says otherwise is the most common misdrawn diagram.
2. **Outbound from a private subnet needs a NAT.** A NAT gateway is per
   availability zone, is billed hourly and per gigabyte, and is a single point of
   failure per zone if you only build one. A great deal of surprise AWS spend is
   inter-zone traffic through one NAT.
3. **A gateway endpoint removes the NAT for S3 and DynamoDB.** Traffic to them
   can stay on the AWS network for free instead of crossing a NAT you pay for.
   Not knowing this is worth real money on a busy system.
4. **Security groups are stateful; network ACLs are not.** A security group is
   attached to a resource and allows the reply automatically; an ACL is attached
   to the subnet and needs both directions. Reaching for an ACL for something a
   security group does is a sign of the model being wrong.
5. **Security groups reference each other.** "The database accepts from the API's
   security group" is the rule you want, not a CIDR range — it keeps meaning what
   you meant when the addresses change.
6. **Putting a function in a VPC costs you.** It is how you reach a private
   database, and it means the function's networking is set up per environment;
   it also means reaching anything on the internet now needs a NAT. Do it because
   something private requires it, not by default.

<!-- CHECKS:START — hidden from the learner -->

## Check they actually understood

- What makes a subnet public? *(its route table, pointing at an internet
  gateway — nothing else)*
- A private instance needs to call an external API. What is in the path, and
  what does it cost? *(a NAT gateway; hourly plus per gigabyte, per zone)*
- The same instance writes to S3 all day. How do you stop paying for that
  through the NAT? *(a gateway endpoint)*
- The database allows inbound from 10.0.0.0/16. What would you write instead and
  why? *(the API's security group; it keeps meaning the right thing)*
- Why not put every function in the VPC by default? *(networking per
  environment, and a NAT for anything outbound; take the cost when something
  private makes you)*

Common wrong answers:

- "It is in a private subnet, so it is secure." It is unreachable from the
  internet. Everything inside the VPC can still reach it.
- "Use a network ACL to allow the return traffic." Security groups are stateful;
  needing that usually means the design is wrong.
- "One NAT gateway is enough." It is, until that zone goes.

<!-- CHECKS:END -->
