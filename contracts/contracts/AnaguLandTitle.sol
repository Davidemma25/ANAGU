// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AnaguLandTitle
 * @notice Academic prototype ERC-721 Land Title & Regulated Polygon Escrow Marketplace.
 * @dev Non-bypassable registry controls:
 *   - Only REGISTRAR_ROLE can mint titles; sellers settle funded marketplace sales.
 *   - Direct owner-to-owner transferFrom / safeTransferFrom calls are blocked.
 *   - Only GOVERNOR_ROLE can revoke titles under statutory grounds, permanently blocking reuse.
 */
contract AnaguLandTitle is ERC721, ERC721URIStorage, AccessControl, ReentrancyGuard {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");

    enum TitleStatus {
        Active,
        Revoked
    }

    enum RevocationGround {
        None,
        OverridingPublicInterest,
        BreachOfStatutoryCondition
    }

    struct TitleRecord {
        uint256 tokenId;
        string parcelCode;
        string applicationRef;
        string metadataUri;
        uint256 issuedAt;
        address issuedBy;
        TitleStatus status;
        RevocationGround revocationGround;
        string revocationReason;
        uint256 revokedAt;
        address revokedBy;
    }

    struct TransferHistoryEntry {
        address from;
        address to;
        uint256 priceWei;
        uint256 timestamp;
        string transferType;
    }

    struct SaleListing {
        uint256 tokenId;
        address seller;
        uint256 priceWei;
        address buyer;
        uint256 escrowFundedWei;
        bool isListed;
        bool escrowFunded;
    }

    uint256 private _nextTokenId = 1;
    bool private _settlementAuthorized = false;

    mapping(uint256 => TitleRecord) private _titles;
    mapping(uint256 => TransferHistoryEntry[]) private _transferHistory;
    mapping(uint256 => SaleListing) private _listings;
    mapping(bytes32 => bool) private _parcelCodeUsed;
    mapping(bytes32 => bool) private _applicationRefUsed;

    error TransferBlockedByRegistryRule(uint256 tokenId);
    error TitleIsRevoked(uint256 tokenId);
    error TitleNotFound(uint256 tokenId);
    error ParcelAlreadyTitled(string parcelCode);
    error ApplicationAlreadyTitled(string applicationRef);
    error InvalidRevocationGround();
    error RevocationReasonTooShort();
    error NotTitleOwner(uint256 tokenId, address caller);
    error InvalidListingPrice();
    error ListingNotActive(uint256 tokenId);
    error EscrowAlreadyFunded(uint256 tokenId);
    error EscrowNotFunded(uint256 tokenId);
    error IncorrectPaymentAmount(uint256 expected, uint256 provided);
    error BuyerCannotBeSeller();
    error NotListingSeller(address caller, address seller);

    event TitleIssued(
        uint256 indexed tokenId,
        address indexed owner,
        string parcelCode,
        string applicationRef,
        string metadataUri,
        address indexed issuedBy
    );

    event TitleRevoked(
        uint256 indexed tokenId,
        RevocationGround indexed ground,
        string reason,
        address indexed revokedBy,
        uint256 revokedAt
    );

    event ParcelListed(uint256 indexed tokenId, address indexed seller, uint256 priceWei);
    event ListingCancelled(uint256 indexed tokenId, address indexed cancelledBy);
    event EscrowFunded(uint256 indexed tokenId, address indexed buyer, uint256 amountWei);
    event SaleSettled(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 priceWei
    );
    event EscrowRefunded(uint256 indexed tokenId, address indexed buyer, uint256 amountWei);

    constructor(address initialAdmin, address initialRegistrar, address initialGovernor)
        ERC721("ANAGU Digital Land Title", "ANAGU")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(REGISTRAR_ROLE, initialRegistrar);
        _grantRole(GOVERNOR_ROLE, initialGovernor);
    }

    function issueTitle(
        address to,
        string calldata parcelCode,
        string calldata applicationRef,
        string calldata metadataUri
    ) external onlyRole(REGISTRAR_ROLE) returns (uint256) {
        require(to != address(0), "Recipient wallet cannot be zero address");
        require(bytes(parcelCode).length > 0, "Parcel code is required");
        require(bytes(applicationRef).length > 0, "Application reference is required");

        bytes32 parcelKey = keccak256(bytes(parcelCode));
        bytes32 appKey = keccak256(bytes(applicationRef));
        if (_parcelCodeUsed[parcelKey]) revert ParcelAlreadyTitled(parcelCode);
        if (_applicationRefUsed[appKey]) revert ApplicationAlreadyTitled(applicationRef);

        uint256 tokenId = _nextTokenId++;
        _parcelCodeUsed[parcelKey] = true;
        _applicationRefUsed[appKey] = true;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataUri);

        _titles[tokenId] = TitleRecord({
            tokenId: tokenId,
            parcelCode: parcelCode,
            applicationRef: applicationRef,
            metadataUri: metadataUri,
            issuedAt: block.timestamp,
            issuedBy: msg.sender,
            status: TitleStatus.Active,
            revocationGround: RevocationGround.None,
            revocationReason: "",
            revokedAt: 0,
            revokedBy: address(0)
        });

        _transferHistory[tokenId].push(
            TransferHistoryEntry({
                from: address(0),
                to: to,
                priceWei: 0,
                timestamp: block.timestamp,
                transferType: "MINT_ISSUANCE"
            })
        );

        emit TitleIssued(tokenId, to, parcelCode, applicationRef, metadataUri, msg.sender);
        return tokenId;
    }

    function revokeTitle(
        uint256 tokenId,
        RevocationGround ground,
        string calldata reason
    ) external onlyRole(GOVERNOR_ROLE) {
        if (_ownerOf(tokenId) == address(0)) revert TitleNotFound(tokenId);
        TitleRecord storage title = _titles[tokenId];
        if (title.status == TitleStatus.Revoked) revert TitleIsRevoked(tokenId);
        if (
            ground != RevocationGround.OverridingPublicInterest &&
            ground != RevocationGround.BreachOfStatutoryCondition
        ) {
            revert InvalidRevocationGround();
        }
        if (bytes(reason).length < 10) revert RevocationReasonTooShort();

        title.status = TitleStatus.Revoked;
        title.revocationGround = ground;
        title.revocationReason = reason;
        title.revokedAt = block.timestamp;
        title.revokedBy = msg.sender;

        if (_listings[tokenId].isListed) {
            _listings[tokenId].isListed = false;
        }

        emit TitleRevoked(tokenId, ground, reason, msg.sender, block.timestamp);
    }

    function listParcelForSale(uint256 tokenId, uint256 priceWei) external {
        if (_ownerOf(tokenId) == address(0)) revert TitleNotFound(tokenId);
        if (_titles[tokenId].status == TitleStatus.Revoked) revert TitleIsRevoked(tokenId);
        if (ownerOf(tokenId) != msg.sender) revert NotTitleOwner(tokenId, msg.sender);
        if (priceWei == 0) revert InvalidListingPrice();
        if (_listings[tokenId].escrowFunded) revert EscrowAlreadyFunded(tokenId);

        _listings[tokenId] = SaleListing({
            tokenId: tokenId,
            seller: msg.sender,
            priceWei: priceWei,
            buyer: address(0),
            escrowFundedWei: 0,
            isListed: true,
            escrowFunded: false
        });

        emit ParcelListed(tokenId, msg.sender, priceWei);
    }

    function cancelListing(uint256 tokenId) external {
        SaleListing storage listing = _listings[tokenId];
        if (!listing.isListed) revert ListingNotActive(tokenId);
        if (listing.escrowFunded) revert EscrowAlreadyFunded(tokenId);
        require(
            listing.seller == msg.sender || hasRole(REGISTRAR_ROLE, msg.sender),
            "Only seller or Registrar can cancel listing"
        );

        delete _listings[tokenId];
        emit ListingCancelled(tokenId, msg.sender);
    }

    function buyListedParcel(uint256 tokenId) external payable nonReentrant {
        if (_ownerOf(tokenId) == address(0)) revert TitleNotFound(tokenId);
        if (_titles[tokenId].status == TitleStatus.Revoked) revert TitleIsRevoked(tokenId);

        SaleListing storage listing = _listings[tokenId];
        if (!listing.isListed) revert ListingNotActive(tokenId);
        if (listing.escrowFunded) revert EscrowAlreadyFunded(tokenId);
        if (msg.sender == listing.seller) revert BuyerCannotBeSeller();
        if (msg.value != listing.priceWei) {
            revert IncorrectPaymentAmount(listing.priceWei, msg.value);
        }

        listing.buyer = msg.sender;
        listing.escrowFundedWei = msg.value;
        listing.escrowFunded = true;

        emit EscrowFunded(tokenId, msg.sender, msg.value);
    }

    function settleApprovedSale(uint256 tokenId) external nonReentrant {
        if (_ownerOf(tokenId) == address(0)) revert TitleNotFound(tokenId);
        if (_titles[tokenId].status == TitleStatus.Revoked) revert TitleIsRevoked(tokenId);

        SaleListing storage listing = _listings[tokenId];
        if (!listing.isListed) revert ListingNotActive(tokenId);
        if (!listing.escrowFunded) revert EscrowNotFunded(tokenId);
        if (msg.sender != listing.seller) {
            revert NotListingSeller(msg.sender, listing.seller);
        }

        address seller = listing.seller;
        address buyer = listing.buyer;
        uint256 amount = listing.escrowFundedWei;

        delete _listings[tokenId];

        _settlementAuthorized = true;
        _transfer(seller, buyer, tokenId);
        _settlementAuthorized = false;

        _transferHistory[tokenId].push(
            TransferHistoryEntry({
                from: seller,
                to: buyer,
                priceWei: amount,
                timestamp: block.timestamp,
                transferType: "REGULATED_ESCROW_SALE"
            })
        );

        (bool sent, ) = payable(seller).call{value: amount}("");
        require(sent, "POL settlement payout to seller failed");

        emit SaleSettled(tokenId, seller, buyer, amount);
    }

    function withdrawEscrowOnRevocation(uint256 tokenId) external nonReentrant {
        SaleListing storage listing = _listings[tokenId];
        if (!listing.escrowFunded) revert EscrowNotFunded(tokenId);
        if (_titles[tokenId].status != TitleStatus.Revoked) {
            revert("Escrow refund only allowed when title is revoked");
        }
        require(
            msg.sender == listing.buyer || hasRole(REGISTRAR_ROLE, msg.sender),
            "Only buyer or Registrar can withdraw escrow"
        );

        address buyer = listing.buyer;
        uint256 refundAmount = listing.escrowFundedWei;
        delete _listings[tokenId];

        (bool refunded, ) = payable(buyer).call{value: refundAmount}("");
        require(refunded, "Escrow refund transfer failed");

        emit EscrowRefunded(tokenId, buyer, refundAmount);
    }

    function transferForApprovedEscrow(uint256 tokenId, address buyer)
        external
        onlyRole(ESCROW_ROLE)
        nonReentrant
    {
        if (_ownerOf(tokenId) == address(0)) revert TitleNotFound(tokenId);
        if (_titles[tokenId].status == TitleStatus.Revoked) revert TitleIsRevoked(tokenId);
        if (buyer == address(0)) revert("Buyer cannot be zero address");

        address seller = ownerOf(tokenId);
        _settlementAuthorized = true;
        _transfer(seller, buyer, tokenId);
        _settlementAuthorized = false;

        _transferHistory[tokenId].push(
            TransferHistoryEntry({
                from: seller,
                to: buyer,
                priceWei: 0,
                timestamp: block.timestamp,
                transferType: "APPROVED_ANAGU_ESCROW_SALE"
            })
        );
    }

    function getTitle(uint256 tokenId) external view returns (TitleRecord memory) {
        if (_ownerOf(tokenId) == address(0)) revert TitleNotFound(tokenId);
        return _titles[tokenId];
    }

    function getListing(uint256 tokenId) external view returns (SaleListing memory) {
        return _listings[tokenId];
    }

    function getTransferHistory(uint256 tokenId)
        external
        view
        returns (TransferHistoryEntry[] memory)
    {
        if (_ownerOf(tokenId) == address(0)) revert TitleNotFound(tokenId);
        return _transferHistory[tokenId];
    }

    function totalTitlesIssued() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC721) returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            if (_titles[tokenId].status == TitleStatus.Revoked) {
                revert TitleIsRevoked(tokenId);
            }
            if (!_settlementAuthorized) {
                revert TransferBlockedByRegistryRule(tokenId);
            }
        }
        return super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
