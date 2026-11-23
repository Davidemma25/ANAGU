// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IApprovedEscrowTitle {
    function transferForApprovedEscrow(uint256 tokenId, address buyer) external;
}

contract AnaguEscrow is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint16 public constant COMMISSION_BPS = 200;
    uint16 public constant BPS_DENOMINATOR = 10_000;

    IERC20 public immutable anaguToken;
    IERC721 public immutable titleContract;
    IApprovedEscrowTitle public immutable approvedTitleContract;
    address public immutable treasury;

    enum EscrowStatus {
        None,
        Listed,
        Funded,
        Settled,
        Cancelled,
        Refunded,
        Expired
    }

    struct EscrowListing {
        uint256 tokenId;
        address seller;
        address buyer;
        uint256 price;
        uint64 expiresAt;
        EscrowStatus status;
    }

    mapping(uint256 => EscrowListing) private _escrows;

    event ParcelListed(
        uint256 indexed tokenId,
        address indexed seller,
        uint256 price,
        uint64 expiresAt
    );
    event EscrowFunded(uint256 indexed tokenId, address indexed buyer, uint256 amount);
    event EscrowSettled(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 sellerAmount,
        uint256 treasuryAmount
    );
    event EscrowCancelled(uint256 indexed tokenId, address indexed caller);
    event EscrowRefunded(uint256 indexed tokenId, address indexed buyer, uint256 amount);
    event EscrowExpired(uint256 indexed tokenId, address indexed buyer, uint256 amount);

    error ZeroAddress();
    error InvalidPrice();
    error InvalidExpiry();
    error ListingNotAvailable(uint256 tokenId);
    error NotSeller(address caller, address seller);
    error NotBuyer(address caller, address buyer);
    error BuyerCannotBeSeller();
    error EscrowNotFunded(uint256 tokenId);
    error EscrowAlreadyFunded(uint256 tokenId);
    error EscrowNotExpired(uint256 tokenId, uint64 expiresAt);
    error IncorrectPaymentAmount(uint256 expected, uint256 provided);
    error NFTNotOwnedBySeller(uint256 tokenId, address seller);

    constructor(
        address admin,
        address registrar,
        address treasuryAddress,
        address anaguTokenAddress,
        address titleContractAddress
    ) {
        if (
            admin == address(0) ||
            registrar == address(0) ||
            treasuryAddress == address(0) ||
            anaguTokenAddress == address(0) ||
            titleContractAddress == address(0)
        ) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, registrar);
        _grantRole(PAUSER_ROLE, admin);

        treasury = treasuryAddress;
        anaguToken = IERC20(anaguTokenAddress);
        titleContract = IERC721(titleContractAddress);
        approvedTitleContract = IApprovedEscrowTitle(titleContractAddress);
    }

    function listParcel(uint256 tokenId, uint256 price, uint64 expiresAt) external whenNotPaused {
        if (price == 0) revert InvalidPrice();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (titleContract.ownerOf(tokenId) != msg.sender) {
            revert NFTNotOwnedBySeller(tokenId, msg.sender);
        }

        EscrowListing storage existing = _escrows[tokenId];
        if (existing.status == EscrowStatus.Listed || existing.status == EscrowStatus.Funded) {
            revert ListingNotAvailable(tokenId);
        }

        _escrows[tokenId] = EscrowListing({
            tokenId: tokenId,
            seller: msg.sender,
            buyer: address(0),
            price: price,
            expiresAt: expiresAt,
            status: EscrowStatus.Listed
        });

        emit ParcelListed(tokenId, msg.sender, price, expiresAt);
    }

    function fundEscrow(uint256 tokenId) external whenNotPaused nonReentrant {
        EscrowListing storage listing = _escrows[tokenId];
        if (listing.status != EscrowStatus.Listed) revert ListingNotAvailable(tokenId);
        if (block.timestamp >= listing.expiresAt) revert EscrowNotExpired(tokenId, listing.expiresAt);
        if (msg.sender == listing.seller) revert BuyerCannotBeSeller();
        if (titleContract.ownerOf(tokenId) != listing.seller) {
            revert NFTNotOwnedBySeller(tokenId, listing.seller);
        }

        uint256 allowance = anaguToken.allowance(msg.sender, address(this));
        if (allowance < listing.price) revert IncorrectPaymentAmount(listing.price, allowance);

        anaguToken.safeTransferFrom(msg.sender, address(this), listing.price);
        listing.buyer = msg.sender;
        listing.status = EscrowStatus.Funded;

        emit EscrowFunded(tokenId, msg.sender, listing.price);
    }

    function settleSale(uint256 tokenId) external whenNotPaused nonReentrant {
        EscrowListing storage listing = _escrows[tokenId];
        if (listing.status != EscrowStatus.Funded) revert EscrowNotFunded(tokenId);
        if (msg.sender != listing.seller) revert NotSeller(msg.sender, listing.seller);
        if (titleContract.ownerOf(tokenId) != listing.seller) {
            revert NFTNotOwnedBySeller(tokenId, listing.seller);
        }

        uint256 commission = (listing.price * COMMISSION_BPS) / BPS_DENOMINATOR;
        uint256 sellerAmount = listing.price - commission;
        address seller = listing.seller;
        address buyer = listing.buyer;

        listing.status = EscrowStatus.Settled;
        approvedTitleContract.transferForApprovedEscrow(tokenId, buyer);

        anaguToken.safeTransfer(seller, sellerAmount);
        if (commission > 0) {
            anaguToken.safeTransfer(treasury, commission);
        }

        emit EscrowSettled(tokenId, seller, buyer, sellerAmount, commission);
    }

    function cancelListing(uint256 tokenId) external whenNotPaused nonReentrant {
        EscrowListing storage listing = _escrows[tokenId];
        if (listing.status != EscrowStatus.Listed) revert ListingNotAvailable(tokenId);
        if (msg.sender != listing.seller && !hasRole(REGISTRAR_ROLE, msg.sender)) {
            revert NotSeller(msg.sender, listing.seller);
        }

        listing.status = EscrowStatus.Cancelled;
        emit EscrowCancelled(tokenId, msg.sender);
    }

    function refundEscrow(uint256 tokenId) external whenNotPaused nonReentrant {
        EscrowListing storage listing = _escrows[tokenId];
        if (listing.status != EscrowStatus.Funded) revert EscrowNotFunded(tokenId);

        bool canRefund =
            msg.sender == listing.buyer ||
            hasRole(REGISTRAR_ROLE, msg.sender);
        if (!canRefund) revert NotBuyer(msg.sender, listing.buyer);
        if (block.timestamp < listing.expiresAt) {
            revert EscrowNotExpired(tokenId, listing.expiresAt);
        }

        listing.status = EscrowStatus.Expired;
        anaguToken.safeTransfer(listing.buyer, listing.price);
        emit EscrowExpired(tokenId, listing.buyer, listing.price);
    }

    function refundFundedEscrow(uint256 tokenId) external onlyRole(REGISTRAR_ROLE) whenNotPaused nonReentrant {
        EscrowListing storage listing = _escrows[tokenId];
        if (listing.status != EscrowStatus.Funded) revert EscrowNotFunded(tokenId);

        address buyer = listing.buyer;
        listing.status = EscrowStatus.Refunded;
        anaguToken.safeTransfer(buyer, listing.price);
        emit EscrowRefunded(tokenId, buyer, listing.price);
    }

    function getEscrow(uint256 tokenId) external view returns (EscrowListing memory) {
        return _escrows[tokenId];
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
