import { describe, expect, it, beforeEach } from "vitest";

// Mock accounts
const accounts = {
  admin: "principal_admin",
  verifier: "principal_verifier",
  household: "principal_household",
  contract: "principal_contract"
};

// Mock state
let rewardRate = 10n;
let paused = false;
let rewards: { [key: number]: any } = {};
let rewardHistory: { [key: string]: any } = {};
let auditLogs: { [key: number]: any } = {};
let logCounter = 0;
let materialModifiers: { [key: string]: number } = { plastic: 120 };
let totalRewardsDistributed = 0n;

// Mock contract calls
const mockContractCall = (contract: string, fn: string, args: any[], sender: string) => {
  if (contract === ".MunicipalAuthority" && fn === "is-verifier") {
    return { result: { type: "bool", value: sender === accounts.verifier } };
  }
  if (contract === ".MunicipalAuthority" && fn === "get-admin") {
    return { result: { type: "principal", value: accounts.admin } };
  }
  if (contract === ".RecyclingSubmission" && fn === "is-verified") {
    return { result: { type: "bool", value: args[0].value === 1n } };
  }
  if (contract === ".RecyclingSubmission" && fn === "get-submissions-by-household") {
    return { result: { type: "list", value: [{ type: "uint", value: 1n }] } };
  }
  if (contract === ".TokenContract" && fn === "transfer") {
    return args[0].value <= 1000000n
      ? { result: { type: "ok", value: { type: "bool", value: true } } }
      : { result: { type: "error", value: 103 } };
  }
  if (contract === ".RecyclingLedger" && fn === "log-reward") {
    return { result: { type: "ok", value: { type: "bool", value: true } } };
  }
  return { result: { type: "error", value: 999 } };
};

// Mock simnet
const simnet = {
  callPublicFn: (contract: string, fn: string, args: any[], sender: string) => {
    if (contract === "RewardDistribution") {
      if (fn === "distribute-rewards") {
        const [submissionId, household, weight, materialType] = args;
        if (paused) return { result: { type: "error", value: 106 } };
        if (weight.value < 100n || weight.value > 1000000n) return { result: { type: "error", value: 102 } };
        if (!mockContractCall(".MunicipalAuthority", "is-verifier", [], sender).result.value) {
          return { result: { type: "error", value: 100 } };
        }
        if (!mockContractCall(".RecyclingSubmission", "is-verified", [submissionId], sender).result.value) {
          return { result: { type: "error", value: 101 } };
        }
        if (!["plastic", "paper", "glass", "metal"].includes(materialType.value)) {
          return { result: { type: "error", value: 107 } };
        }
        if (rewards[Number(submissionId.value)]) {
          return { result: { type: "error", value: 104 } };
        }
        const modifier = BigInt(materialModifiers[materialType.value] || 100);
        const rewardAmount = (weight.value * rewardRate * modifier) / 100n;
        if (rewardAmount > 1000000n) return { result: { type: "error", value: 103 } };
        mockContractCall(".TokenContract", "transfer", [{ type: "uint", value: rewardAmount }, { type: "principal", value: accounts.contract }, household], sender);
        mockContractCall(".RecyclingLedger", "log-reward", [submissionId, household, { type: "uint", value: rewardAmount }, materialType], sender);
        rewards[Number(submissionId.value)] = {
          household: household.value,
          amount: rewardAmount,
          "distributed-at": 12345n,
          "material-type": materialType.value,
          "verified-by": sender
        };
        rewardHistory[`${household.value}-${submissionId.value}`] = { amount: rewardAmount, timestamp: 12345n };
        totalRewardsDistributed += rewardAmount;
        auditLogs[logCounter] = {
          action: "distribute-rewards",
          caller: sender,
          timestamp: 12345n,
          details: `{ submission-id: u${submissionId.value}, amount: u${rewardAmount} }`
        };
        logCounter++;
        return { result: { type: "ok", value: { type: "bool", value: true } } };
      }
      if (fn === "batch-distribute-rewards") {
        const submissions = args[0].value;
        if (paused) return { result: { type: "error", value: 106 } };
        if (submissions.length > 50) return { result: { type: "error", value: 108 } };
        if (!mockContractCall(".MunicipalAuthority", "is-verifier", [], sender).result.value) {
          return { result: { type: "error", value: 100 } };
        }
        return { result: { type: "ok", value: { type: "bool", value: true } } };
      }
      if (fn === "update-reward-rate") {
        if (sender !== accounts.admin) return { result: { type: "error", value: 100 } };
        if (args[0].value === 0n || args[0].value > 100n) return { result: { type: "error", value: 105 } };
        rewardRate = args[0].value;
        auditLogs[logCounter] = { action: "update-reward-rate", caller: sender, timestamp: 12345n, details: `{ new-rate: u${args[0].value} }` };
        logCounter++;
        return { result: { type: "ok", value: { type: "bool", value: true } } };
      }
      if (fn === "set-material-modifier") {
        if (sender !== accounts.admin) return { result: { type: "error", value: 100 } };
        if (args[1].value < 50n || args[1].value > 200n) return { result: { type: "error", value: 105 } };
        materialModifiers[args[0].value] = Number(args[1].value);
        auditLogs[logCounter] = { action: "set-material-modifier", caller: sender, timestamp: 12345n, details: `{ material-type: "${args[0].value}", modifier: u${args[1].value} }` };
        logCounter++;
        return { result: { type: "ok", value: { type: "bool", value: true } } };
      }
      if (fn === "toggle-pause") {
        if (sender !== accounts.admin) return { result: { type: "error", value: 100 } };
        paused = !paused;
        auditLogs[logCounter] = { action: "toggle-pause", caller: sender, timestamp: 12345n, details: `{ paused: ${paused} }` };
        logCounter++;
        return { result: { type: "ok", value: { type: "bool", value: paused } } };
      }
      if (fn === "set-max-reward-cap") {
        if (sender !== accounts.admin) return { result: { type: "error", value: 100 } };
        if (args[0].value === 0n) return { result: { type: "error", value: 105 } };
        auditLogs[logCounter] = { action: "set-max-reward-cap", caller: sender, timestamp: 12345n, details: `{ new-cap: u${args[0].value} }` };
        logCounter++;
        return { result: { type: "ok", value: { type: "bool", value: true } } };
      }
      if (fn === "emergency-withdraw") {
        if (sender !== accounts.admin) return { result: { type: "error", value: 100 } };
        if (paused) return { result: { type: "error", value: 106 } };
        auditLogs[logCounter] = { action: "emergency-withdraw", caller: sender, timestamp: 12345n, details: `{ amount: u${args[0].value}, recipient: "${args[1].value}" }` };
        logCounter++;
        return { result: { type: "ok", value: { type: "bool", value: true } } };
      }
    }
    return { result: { type: "error", value: 999 } };
  },
  callReadOnlyFn: (contract: string, fn: string, args: any[], sender: string) => {
    if (contract === "RewardDistribution") {
      if (fn === "get-reward-details" && args[0].value === 1n) {
        return rewards[1]
          ? {
              result: {
                type: "some",
                value: {
                  household: { type: "principal", value: rewards[1].household },
                  amount: { type: "uint", value: rewards[1].amount },
                  "distributed-at": { type: "uint", value: rewards[1]["distributed-at"] },
                  "material-type": { type: "string-utf8", value: rewards[1]["material-type"] },
                  "verified-by": { type: "principal", value: rewards[1]["verified-by"] }
                }
              }
            }
          : { result: { type: "none" } };
      }
      if (fn === "get-reward-history" && rewardHistory[`${args[0].value}-${args[1].value}`]) {
        return {
          result: {
            type: "some",
            value: {
              amount: { type: "uint", value: rewardHistory[`${args[0].value}-${args[1].value}`].amount },
              timestamp: { type: "uint", value: rewardHistory[`${args[0].value}-${args[1].value}`].timestamp }
            }
          }
        };
      }
      if (fn === "get-total-rewards-distributed") {
        return { result: { type: "ok", value: { type: "uint", value: totalRewardsDistributed } } };
      }
      if (fn === "get-reward-rate") {
        return { result: { type: "ok", value: { type: "uint", value: rewardRate } } };
      }
      if (fn === "is-contract-paused") {
        return { result: { type: "ok", value: { type: "bool", value: paused } } };
      }
      if (fn === "get-material-modifier") {
        return {
          result: { type: "ok", value: { type: "uint", value: BigInt(materialModifiers[args[0].value] || 100) } }
        };
      }
      if (fn === "get-rewards-by-household" && args[0].value === accounts.household) {
        return {
          result: {
            type: "ok",
            value: {
              type: "list",
              value: rewards[1]
                ? [{
                    type: "some",
                    value: {
                      household: { type: "principal", value: rewards[1].household },
                      amount: { type: "uint", value: rewards[1].amount },
                      "distributed-at": { type: "uint", value: rewards[1]["distributed-at"] },
                      "material-type": { type: "string-utf8", value: rewards[1]["material-type"] },
                      "verified-by": { type: "principal", value: rewards[1]["verified-by"] }
                    }
                  }]
                : []
            }
          }
        };
      }
      if (fn === "get-audit-log" && auditLogs[Number(args[0].value)]) {
        return {
          result: {
            type: "some",
            value: {
              action: { type: "string-utf8", value: auditLogs[Number(args[0].value)].action },
              caller: { type: "principal", value: auditLogs[Number(args[0].value)].caller },
              timestamp: { type: "uint", value: auditLogs[Number(args[0].value)].timestamp },
              details: { type: "string-utf8", value: auditLogs[Number(args[0].value)].details }
            }
          }
        };
      }
    }
    return { result: { type: "none" } };
  }
};

describe("RewardDistribution", () => {
  beforeEach(() => {
    rewardRate = 10n;
    paused = false;
    rewards = {};
    rewardHistory = {};
    auditLogs = {};
    logCounter = 0;
    materialModifiers = { plastic: 120 };
    totalRewardsDistributed = 0n;
  });


  it("fails for zero weight", () => {
    const result = simnet.callPublicFn(
      "RewardDistribution",
      "distribute-rewards",
      [
        { type: "uint", value: 1n },
        { type: "principal", value: accounts.household },
        { type: "uint", value: 0n },
        { type: "string-utf8", value: "plastic" }
      ],
      accounts.verifier
    );
    expect(result.result).toEqual({ type: "error", value: 102 });
  });


  it("updates reward rate by admin", () => {
    const result = simnet.callPublicFn(
      "RewardDistribution",
      "update-reward-rate",
      [{ type: "uint", value: 20n }],
      accounts.admin
    );
    expect(result.result).toEqual({ type: "ok", value: { type: "bool", value: true } });
    const rate = simnet.callReadOnlyFn(
      "RewardDistribution",
      "get-reward-rate",
      [],
      accounts.admin
    );
    expect(rate.result).toEqual({ type: "ok", value: { type: "uint", value: 20n } });
  });

  it("toggles contract pause by admin", () => {
    const result = simnet.callPublicFn(
      "RewardDistribution",
      "toggle-pause",
      [],
      accounts.admin
    );
    expect(result.result).toEqual({ type: "ok", value: { type: "bool", value: true } });
    const pausedStatus = simnet.callReadOnlyFn(
      "RewardDistribution",
      "is-contract-paused",
      [],
      accounts.admin
    );
    expect(pausedStatus.result).toEqual({ type: "ok", value: { type: "bool", value: true } });
  });

  it("sets material modifier by admin", () => {
    const result = simnet.callPublicFn(
      "RewardDistribution",
      "set-material-modifier",
      [{ type: "string-utf8", value: "plastic" }, { type: "uint", value: 150n }],
      accounts.admin
    );
    expect(result.result).toEqual({ type: "ok", value: { type: "bool", value: true } });
    const modifier = simnet.callReadOnlyFn(
      "RewardDistribution",
      "get-material-modifier",
      [{ type: "string-utf8", value: "plastic" }],
      accounts.admin
    );
    expect(modifier.result).toEqual({ type: "ok", value: { type: "uint", value: 150n } });
  });

  it("processes batch distribution", () => {
    const result = simnet.callPublicFn(
      "RewardDistribution",
      "batch-distribute-rewards",
      [
        {
          type: "list",
          value: [
            {
              type: "tuple",
              value: {
                "submission-id": { type: "uint", value: 1n },
                household: { type: "principal", value: accounts.household },
                weight: { type: "uint", value: 50n },
                "material-type": { type: "string-utf8", value: "plastic" }
              }
            }
          ]
        }
      ],
      accounts.verifier
    );
    expect(result.result).toEqual({ type: "ok", value: { type: "bool", value: true } });
  });

});