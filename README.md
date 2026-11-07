# dsh-superagent

> **Research prototype for reference only, not an official DeepSeek product.** This code grew out of our team's day-to-day development work, with much of the engineering done by coding agents. Treat it as research code, not production-ready software. It may still contain bugs, and its coding style and engineering practices may be inconsistent. Review and adapt it before using it in your own environment.
>
> We have adapted it for publication, so it is not identical to our internal version or the implementation described in *Exploring Super-agent Design: Towards a More Autonomous Agent System*. Some designs discussed in the article are directions for future development and are not implemented in this prototype.

dsh-superagent is a proactive coding agent for one GitHub repository, packaged as a bundle for [DeepSeek Harness](https://www.deepseek.com/en/harness/). It listens to GitHub and, optionally, Feishu. When someone allowed asks the agent for work, it opens a work item, works on it in its own agent session and directory, and answers in the original conversation, for example with a pull request. A web panel shows what needs a person.

It is also a way of working with an agent: **take as little human attention as possible, and give as much value as possible.** An agent that can act for a whole team can also waste a whole team's attention, so it acts only when asked or when a rule the team wrote allows it, and speaks only when someone must act or can use a result. [docs/000-philosophy.md](docs/000-philosophy.md) explains the principle and what it asks of the operator.

## Setup

Setup has many steps, so an agent does it with you. Ask your coding agent:

> Read SETUP.md in this repository and set up dsh-superagent with me.

It asks one short question at a time, shows the full plan once, and then installs and configures everything. [SETUP.md](SETUP.md) is what it follows.

## Your first Ticket

One request, from a GitHub Issue to a pull request, once [Setup](#setup) has finished. The panel is the **Superagent** entry in the DeepSeek Harness Web sidebar; [005 Panel](docs/005-panel.md) describes its pages.

1. **Configure the GitHub Source.** In **Settings → Sources**, fill in the **GitHub** card: the repository as `owner/name`, and the **Agent GitHub CLI** signed in to the agent account. Then add your own login to **GitHub accounts that may originate work** under **Settings → Eval → On each Source**. Changing the card checks the account and restarts dsh-superagent. Expected: the **Source** tab shows the GitHub Source as **Running**, and the card shows the verified account.

2. **Open an Issue that mentions the agent account.** Write `@<agent account> <request>`, for example `@my-agent add a --json flag to the report command`. Expected: the Issue arrives as a Trigger within about a minute, with the default polling interval.

3. **Confirm the candidate in the panel.** The **Trigger** tab lists the Issue's Thread with its new Trigger; that Trigger is the candidate. Expected: the Trigger is there; a clear request needs nothing else from you.

4. **Accept.** An explicit request from an account on the list needs no confirmation: the agent accepts it and opens a Ticket, and the **Eval** tab records the **Accept** Decision. Only an inferred candidate, such as a bot's comment, follows the **Accept mode** and the rules; the default **Observe** mode records it as **Ignore (would accept; observe only)** and starts nothing. Expected: the **Execution** tab lists the new Ticket as **Working**, or as **Queued** while it waits for a worker slot.

5. **Follow the worker and its pull request.** Open the Ticket and choose **Open Session** to read the worker's progress; once the worker reports the pull request, the Ticket's **Subscribed Threads** lists it. Comment on the pull request or the Issue to continue the same Ticket. Expected: the worker opens a pull request, the Ticket stage becomes **Awaiting review**, and the Ticket ends when the pull request closes.

## Documentation

Read the numbered documents in order; each builds only on the ones before it.

- [000 Philosophy](docs/000-philosophy.md)
- [001 Domain model](docs/001-domain.md)
- [002 Authorization](docs/002-authorization.md)
- [003 Execution](docs/003-execution.md)
- [004 Prompts](docs/004-prompts.md)
- [005 Panel](docs/005-panel.md)
- [006 Deployment](docs/006-deployment.md): manual setup, configuration, upgrades and troubleshooting
- [007 Architecture](docs/007-architecture.md)
- [008 Cookbook](docs/008-cookbook.md): adding a Source

## Development

`pnpm check` runs the typecheck, the tests and the build.

## License

[MIT](LICENSE)
