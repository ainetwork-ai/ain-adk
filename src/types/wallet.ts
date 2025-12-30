/**
 * Supported blockchain types for wallet operations.
 */
export enum WalletChainType {
	/** AI Network blockchain */
	AIN = "AIN",
	/** Ethereum and EVM-compatible chains */
	ETHEREUM = "ETHEREUM",
	/** Solana blockchain */
	SOLANA = "SOLANA",
}

/**
 * Configuration for initializing a wallet.
 */
export type WalletConfig = {
	/** Private key in hexadecimal format (with or without 0x prefix) */
	privateKey: string;
	/** Chain type for this wallet */
	chainType: WalletChainType;
	/** Optional chain-specific configuration */
	chainConfig?: ChainConfig;
};

/**
 * Chain-specific configuration parameters.
 */
export type ChainConfig = {
	/** RPC endpoint URL for blockchain communication */
	rpcUrl?: string;
	/** Chain ID (numeric for Ethereum, string for other chains) */
	chainId?: number | string;
	/** Additional chain-specific options */
	options?: Record<string, unknown>;
};

/**
 * Transaction request object for sending transactions.
 */
export type TransactionRequest = {
	/** Recipient address */
	to: string;
	/** Transaction value/amount (in smallest unit, e.g., wei for ETH) */
	value?: string | number;
	/** Transaction data (for contract calls) */
	data?: string;
	/** Gas limit */
	gasLimit?: string | number;
	/** Gas price */
	gasPrice?: string | number;
	/** Nonce (transaction sequence number) */
	nonce?: number;
	/** Additional transaction parameters */
	[key: string]: unknown;
};

/**
 * Response object after transaction execution.
 */
export type TransactionResponse = {
	/** Transaction hash */
	hash: string;
	/** Sender address */
	from: string;
	/** Recipient address */
	to: string;
	/** Transaction value */
	value: string;
	/** Block number (if confirmed) */
	blockNumber?: number;
	/** Transaction status (pending, confirmed, failed) */
	status?: "pending" | "confirmed" | "failed";
	/** Additional response data */
	[key: string]: unknown;
};

/**
 * Wallet information and metadata.
 */
export type WalletInfo = {
	/** Wallet address */
	address: string;
	/** Chain type */
	chainType: WalletChainType;
	/** Public key (if available) */
	publicKey?: string;
};
