import type {
	TransactionRequest,
	TransactionResponse,
	WalletChainType,
	WalletConfig,
	WalletInfo,
} from "@/types/wallet.js";

/**
 * Abstract base class for blockchain wallet implementations.
 *
 * This class defines the common interface that all wallet implementations
 * must follow, enabling consistent interaction across different blockchain
 * platforms (AIN, Ethereum, Solana, etc.).
 *
 * Each concrete wallet implementation should extend this class and provide
 * chain-specific implementations of the abstract methods.
 *
 * @example
 * ```typescript
 * class MyWallet extends BaseWallet {
 *   async initialize() {
 *     // Initialize wallet with private key
 *   }
 *
 *   async signMessage(message: string): Promise<string> {
 *     // Sign message implementation
 *   }
 *
 *   // ... implement other methods
 * }
 * ```
 */
export abstract class BaseWallet {
	/** Chain type for this wallet instance */
	protected chainType: WalletChainType;

	/** Wallet configuration */
	protected config: WalletConfig;

	/** Wallet address (set after initialization) */
	protected address?: string;

	/**
	 * Creates a new wallet instance.
	 *
	 * @param config - Wallet configuration including private key and chain settings
	 */
	constructor(config: WalletConfig) {
		this.config = config;
		this.chainType = config.chainType;
	}

	/**
	 * Initializes the wallet with the provided private key.
	 * Must be called before using other wallet methods.
	 *
	 * @returns Promise that resolves when initialization is complete
	 */
	abstract initialize(): Promise<void>;

	/**
	 * Gets the wallet address.
	 *
	 * @returns The wallet's public address
	 * @throws Error if wallet is not initialized
	 */
	abstract getAddress(): string;

	/**
	 * Gets the wallet's public key (if supported by the chain).
	 *
	 * @returns The wallet's public key, or undefined if not supported
	 */
	abstract getPublicKey(): string | undefined;

	/**
	 * Gets wallet information including address and chain type.
	 *
	 * @returns Wallet metadata
	 */
	getInfo(): WalletInfo {
		return {
			address: this.getAddress(),
			chainType: this.chainType,
			publicKey: this.getPublicKey(),
		};
	}

	/**
	 * Signs a message with the wallet's private key.
	 *
	 * The signature format may vary by chain type:
	 * - Ethereum: EIP-191 personal message signature
	 * - AI Network: Chain-specific signature format
	 * - Solana: Ed25519 signature
	 *
	 * @param message - The message to sign (string or bytes)
	 * @returns Promise resolving to the signature (hex string)
	 */
	abstract signMessage(message: string): Promise<string>;

	/**
	 * Signs a transaction without sending it to the network.
	 *
	 * @param transaction - Transaction request object
	 * @returns Promise resolving to the signed transaction (serialized)
	 */
	abstract signTransaction(transaction: TransactionRequest): Promise<string>;

	/**
	 * Sends a signed transaction to the blockchain network.
	 *
	 * This method handles the complete transaction lifecycle:
	 * 1. Signs the transaction with the wallet's private key
	 * 2. Broadcasts it to the network
	 * 3. Returns transaction response with hash
	 *
	 * Note: This does NOT wait for transaction confirmation.
	 * Use waitForTransaction() to wait for confirmation.
	 *
	 * @param transaction - Transaction request object
	 * @returns Promise resolving to transaction response
	 */
	abstract sendTransaction(
		transaction: TransactionRequest,
	): Promise<TransactionResponse>;

	/**
	 * Gets the current balance of the wallet.
	 *
	 * @returns Promise resolving to balance in smallest unit (wei, lamports, etc.)
	 */
	abstract getBalance(): Promise<string>;

	/**
	 * Waits for a transaction to be confirmed on the blockchain.
	 *
	 * @param txHash - Transaction hash to wait for
	 * @param confirmations - Number of confirmations to wait for (default: 1)
	 * @param timeout - Timeout in milliseconds (default: 60000)
	 * @returns Promise resolving to updated transaction response
	 */
	abstract waitForTransaction(
		txHash: string,
		confirmations?: number,
		timeout?: number,
	): Promise<TransactionResponse>;

	/**
	 * Validates whether an address is valid for this chain.
	 *
	 * @param address - Address to validate
	 * @returns true if address is valid, false otherwise
	 */
	abstract isValidAddress(address: string): boolean;
}
