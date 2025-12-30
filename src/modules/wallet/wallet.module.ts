import { loggers } from "@/utils/logger.js";
import type { BaseWallet } from "./base.wallet.js";

/**
 * Module for managing blockchain wallet instances.
 *
 * WalletModule acts as a registry and manager for multiple wallet instances,
 * allowing agents to interact with different blockchain networks through a
 * unified interface. Each wallet is identified by a unique name.
 *
 * The module supports:
 * - Multiple wallet instances (different chains or accounts)
 * - Dynamic wallet registration and removal
 * - Default wallet selection for convenience
 * - Access control through enable/disable flags
 *
 * Note: This module only provides the interface. Actual wallet implementations
 * for specific chains (AIN, Ethereum, Solana, etc.) should be provided by
 * separate packages that extend the BaseWallet class.
 *
 * @example
 * ```typescript
 * // Import chain-specific wallet implementations
 * import { AinWallet } from '@ainetwork/ain-wallet';
 * import { EthereumWallet } from 'ethereum-wallet-package';
 *
 * const walletModule = new WalletModule();
 *
 * // Add wallets
 * const ainWallet = new AinWallet({
 *   privateKey: process.env.AIN_PRIVATE_KEY,
 *   chainType: WalletChainType.AIN
 * });
 * await ainWallet.initialize();
 * walletModule.addWallet('ain-mainnet', ainWallet);
 *
 * const ethWallet = new EthereumWallet({
 *   privateKey: process.env.ETH_PRIVATE_KEY,
 *   chainType: WalletChainType.ETHEREUM
 * });
 * await ethWallet.initialize();
 * walletModule.addWallet('ethereum', ethWallet);
 *
 * // Set default wallet
 * walletModule.setDefaultWallet('ain-mainnet');
 *
 * // Use wallets
 * const wallet = walletModule.getWallet('ain-mainnet');
 * const address = wallet.getAddress();
 * ```
 */
export class WalletModule {
	/** Map of wallet instances keyed by name */
	private wallets: Map<string, BaseWallet> = new Map();

	/** Name of the default wallet (used when no wallet is specified) */
	private defaultWalletName?: string;

	/**
	 * Adds a wallet instance to the module.
	 *
	 * The wallet must be initialized before adding it to the module.
	 * If a wallet with the same name already exists, it will be replaced.
	 *
	 * @param name - Unique identifier for the wallet
	 * @param wallet - Initialized wallet instance
	 * @throws Error if wallet is not initialized
	 *
	 * @example
	 * ```typescript
	 * const wallet = new AinWallet(config);
	 * await wallet.initialize();
	 * walletModule.addWallet('my-ain-wallet', wallet);
	 * ```
	 */
	addWallet(name: string, wallet: BaseWallet): void {
		try {
			// Verify wallet is initialized by calling getAddress
			wallet.getAddress();
		} catch (error) {
			throw new Error(
				`Cannot add wallet '${name}': Wallet must be initialized before adding to module`,
			);
		}

		this.wallets.set(name, wallet);
		loggers.agent.info(`Wallet '${name}' added successfully`, {
			address: wallet.getAddress(),
			chainType: wallet.getInfo().chainType,
		});

		// Set as default if it's the first wallet
		if (!this.defaultWalletName) {
			this.setDefaultWallet(name);
		}
	}

	/**
	 * Removes a wallet from the module.
	 *
	 * @param name - Name of the wallet to remove
	 * @returns true if wallet was removed, false if it didn't exist
	 *
	 * @example
	 * ```typescript
	 * walletModule.removeWallet('my-old-wallet');
	 * ```
	 */
	removeWallet(name: string): boolean {
		const removed = this.wallets.delete(name);

		if (removed) {
			loggers.agent.info(`Wallet '${name}' removed`);

			// Clear default if it was the removed wallet
			if (this.defaultWalletName === name) {
				this.defaultWalletName = undefined;
				// Set first available wallet as new default
				const firstWalletName = Array.from(this.wallets.keys())[0];
				if (firstWalletName) {
					this.setDefaultWallet(firstWalletName);
				}
			}
		}

		return removed;
	}

	/**
	 * Gets a wallet instance by name.
	 *
	 * @param name - Name of the wallet to retrieve. If not provided, returns default wallet.
	 * @returns The wallet instance
	 * @throws Error if wallet not found or no default wallet set
	 *
	 * @example
	 * ```typescript
	 * const wallet = walletModule.getWallet('ain-mainnet');
	 * const address = wallet.getAddress();
	 * ```
	 */
	getWallet(name?: string): BaseWallet {
		const walletName = name || this.defaultWalletName;

		if (!walletName) {
			throw new Error(
				"No wallet name provided and no default wallet is set. Use setDefaultWallet() to set a default.",
			);
		}

		const wallet = this.wallets.get(walletName);
		if (!wallet) {
			throw new Error(`Wallet '${walletName}' not found`);
		}

		return wallet;
	}

	/**
	 * Sets the default wallet to be used when no wallet name is specified.
	 *
	 * @param name - Name of the wallet to set as default
	 * @throws Error if wallet doesn't exist
	 *
	 * @example
	 * ```typescript
	 * walletModule.setDefaultWallet('ain-mainnet');
	 * const wallet = walletModule.getWallet(); // Returns ain-mainnet wallet
	 * ```
	 */
	setDefaultWallet(name: string): void {
		if (!this.wallets.has(name)) {
			throw new Error(`Cannot set default wallet: Wallet '${name}' not found`);
		}

		this.defaultWalletName = name;
		loggers.agent.info(`Default wallet set to '${name}'`);
	}

	/**
	 * Gets the name of the current default wallet.
	 *
	 * @returns The default wallet name, or undefined if no default is set
	 */
	getDefaultWalletName(): string | undefined {
		return this.defaultWalletName;
	}

	/**
	 * Gets all wallet names registered in the module.
	 *
	 * @returns Array of wallet names
	 *
	 * @example
	 * ```typescript
	 * const walletNames = walletModule.getAllWalletNames();
	 * // ['ain-mainnet', 'ethereum', 'solana']
	 * ```
	 */
	getAllWalletNames(): string[] {
		return Array.from(this.wallets.keys());
	}

	/**
	 * Gets information about all registered wallets.
	 *
	 * @returns Array of wallet info objects with name, address, and chain type
	 *
	 * @example
	 * ```typescript
	 * const walletsInfo = walletModule.getAllWalletsInfo();
	 * // [
	 * //   { name: 'ain-mainnet', address: '0x123...', chainType: 'AIN' },
	 * //   { name: 'ethereum', address: '0xabc...', chainType: 'ETHEREUM' }
	 * // ]
	 * ```
	 */
	getAllWalletsInfo(): Array<{
		name: string;
		address: string;
		chainType: string;
		isDefault: boolean;
	}> {
		return Array.from(this.wallets.entries()).map(([name, wallet]) => ({
			name,
			...wallet.getInfo(),
			isDefault: name === this.defaultWalletName,
		}));
	}

	/**
	 * Checks if a wallet with the given name exists.
	 *
	 * @param name - Name of the wallet to check
	 * @returns true if wallet exists, false otherwise
	 */
	hasWallet(name: string): boolean {
		return this.wallets.has(name);
	}

	/**
	 * Gets the total number of wallets registered.
	 *
	 * @returns Number of wallets
	 */
	getWalletCount(): number {
		return this.wallets.size;
	}
}
