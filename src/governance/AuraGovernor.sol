// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Governor }                    from "@openzeppelin/contracts/governance/Governor.sol";
import { GovernorSettings }            from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import { GovernorCountingSimple }      from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import { GovernorVotes }               from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import { GovernorVotesQuorumFraction } from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import { GovernorTimelockControl }     from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import { TimelockController }          from "@openzeppelin/contracts/governance/TimelockController.sol";
import { IVotes }                      from "@openzeppelin/contracts/governance/utils/IVotes.sol";

/**
 * @title  AuraGovernor
 * @author Sanzhik(traffer7612)
 * @notice On-chain governance for the Aura Protocol.
 *         Voting power is provided by VeAura (vote-escrow AURA).
 *         Successful proposals are queued through a TimelockController before execution.
 *
 * @dev    Phase 7 implementation.
 *         Built on OpenZeppelin Governor v5 multi-extension pattern.
 *
 *         Parameters:
 *           votingDelay    = 1 day   (seconds, timestamp clock)
 *           votingPeriod   = 7 days
 *           proposalThreshold = 100,000 AURA (veAURA)
 *           quorum         = 4% of total veAURA supply
 */
contract AuraGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    /**
     * @param _token     VeAura contract (implements IVotes / IERC5805)
     * @param _timelock  TimelockController that executes queued proposals
     */
    constructor(IVotes _token, TimelockController _timelock)
        Governor("AuraGovernor")
        GovernorSettings(
            1 days,       // votingDelay  (seconds)
            7 days,       // votingPeriod (seconds)
            100_000e18    // proposalThreshold
        )
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(4) // 4%
        GovernorTimelockControl(_timelock)
    {}

    // ------------------------------- Required overrides (diamond inheritance)

    function votingDelay()
        public view override(Governor, GovernorSettings) returns (uint256)
    { return super.votingDelay(); }

    function votingPeriod()
        public view override(Governor, GovernorSettings) returns (uint256)
    { return super.votingPeriod(); }

    function quorum(uint256 timepoint)
        public view override(Governor, GovernorVotesQuorumFraction) returns (uint256)
    { return super.quorum(timepoint); }

    function state(uint256 proposalId)
        public view override(Governor, GovernorTimelockControl) returns (ProposalState)
    { return super.state(proposalId); }

    function proposalNeedsQueuing(uint256 proposalId)
        public view override(Governor, GovernorTimelockControl) returns (bool)
    { return super.proposalNeedsQueuing(proposalId); }

    function proposalThreshold()
        public view override(Governor, GovernorSettings) returns (uint256)
    { return super.proposalThreshold(); }

    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint48) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal view override(Governor, GovernorTimelockControl) returns (address)
    { return super._executor(); }
}
