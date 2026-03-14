"use client";

import { FC, useState } from "react";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useSolanaWallet, useSolanaConnection } from "@/hooks/usePrivySolana";
import { useSDK } from "@/hooks/useSDK";

interface TransferProps {
  mintAddress: PublicKey | null;
  decimals: number;
}

const Transfer: FC<TransferProps> = ({ mintAddress, decimals }) => {
  const { publicKey } = useSolanaWallet();
  const { connection } = useSolanaConnection();
  const sdk = useSDK();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTransfer = async () => {
    if (!mintAddress || !publicKey || !sdk.ready) return;

    setStatus("sending");
    setError(null);
    setSignature(null);

    try {
      const recipientPubkey = new PublicKey(recipient);
      const rawAmount = BigInt(Math.round(parseFloat(amount) * 10 ** decimals));

      const senderAta = getAssociatedTokenAddressSync(
        mintAddress,
        publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const recipientAta = getAssociatedTokenAddressSync(
        mintAddress,
        recipientPubkey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const ixs: TransactionInstruction[] = [];

      // Create recipient ATA if it doesn't exist
      const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
      if (!recipientAtaInfo) {
        ixs.push(
          createAssociatedTokenAccountInstruction(
            publicKey,
            recipientAta,
            recipientPubkey,
            mintAddress,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }

      ixs.push(
        createTransferCheckedInstruction(
          senderAta,
          mintAddress,
          recipientAta,
          publicKey,
          rawAmount,
          decimals,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );

      const sig = await sdk.sendInstructions(ixs);
      setSignature(sig);
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  };

  if (!mintAddress) {
    return (
      <div className="panel">
        <div className="empty-state">
          <p className="text-center text-sm text-slate-400">
            Load a stablecoin first to transfer tokens.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Token Transfer</p>
            <h2 className="panel-title">Transfer</h2>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">From</label>
            <div className="wallet-pill font-mono text-xs text-slate-300">
              <span className="connected-dot" />
              {publicKey?.toBase58() ?? "No wallet connected"}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Recipient Wallet</label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Recipient wallet address"
              className="input-field font-mono text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Amount (tokens, not raw)
            </label>
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100.0"
              className="input-field"
            />
          </div>

          <button
            onClick={() => void handleTransfer()}
            disabled={!sdk.ready || status === "sending" || !recipient || !amount}
            className="btn-primary"
          >
            {status === "sending" ? "Sending..." : "Transfer"}
          </button>

          {!sdk.ready && (
            <p className="text-sm text-amber-200">Connect a wallet to transfer tokens.</p>
          )}
        </div>
      </div>

      {error && (
        <div className="alert-panel alert-critical">
          <p className="text-sm text-rose-200">{error}</p>
        </div>
      )}

      {signature && status === "success" && (
        <div className="alert-panel alert-success">
          <p className="text-sm text-emerald-200">
            Transfer successful. Tx:{" "}
            <span className="font-mono text-xs">{signature}</span>
          </p>
        </div>
      )}
    </div>
  );
};

export default Transfer;
