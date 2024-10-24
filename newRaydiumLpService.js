require('dotenv').config();
const { MongoClient } = require('mongodb');
const bs58 = require('bs58');
const { PublicKey } = require('@solana/web3.js');
const borsh = require('borsh');

// MongoDB connection setup
const MONGO_URI = process.env.MONGO_URI || 'Input mongodb uri';//not sure if necessary if defined correctly in the .env file
const client = new MongoClient(MONGO_URI);
let db;

async function connectToDatabase() {
    try {
        await client.connect();
        db = client.db('Test1');  // Corrected: Access the database 'Test1'
        const collection = db.collection('Test1');  // Corrected: Access the collection 'Test1'

        console.log("Connected to MongoDB.");

        // Insert a sample document (test message)
        await collection.insertOne({ test: "Cazzo" });
        console.log("Sample test document inserted.");

    } catch (error) {
        console.error("MongoDB connection error:", error.message);
    }
}

// Classes for Instructions
class AddLiquidityInstruction {
    constructor(fields) {
        this.instruction = fields.instruction;
        this.baseAmountIn = fields.baseAmountIn;
        this.quoteAmountIn = fields.quoteAmountIn;
        this.fixedSide = fields.fixedSide;
    }
}

class RemoveLiquidityInstruction {
    constructor(fields) {
        this.instruction = fields.instruction;
        this.amountIn = fields.amountIn;
    }
}

// Schema for Add Liquidity
const addLiquiditySchema = new Map([
    [
        AddLiquidityInstruction,
        {
            kind: 'struct',
            fields: [
                ['instruction', 'u8'],
                ['baseAmountIn', 'u64'],
                ['quoteAmountIn', 'u64'],
                ['fixedSide', 'u8']
            ]
        }
    ]
]);

// Schema for Remove Liquidity
const removeLiquiditySchema = new Map([
    [
        RemoveLiquidityInstruction,
        {
            kind: 'struct',
            fields: [
                ['instruction', 'u8'],
                ['amountIn', 'u64']
            ]
        }
    ]
]);

// Function to convert little-endian hex to decimal
function hexToDecimal(hex) {
    const buffer = Buffer.from(hex, 'hex');
    return buffer.readUIntLE(0, buffer.length);
}

// Decoding function for Add Liquidity
function decodeAddLiquidityInstruction(data) {
    const buffer = Buffer.from(bs58.decode(data));
    const decoded = borsh.deserialize(addLiquiditySchema, AddLiquidityInstruction, buffer);

    console.log("Decoded Add Liquidity Instruction:");
    console.log(`Instruction: ${decoded.instruction}`);
    console.log(`Base Amount In: ${hexToDecimal(decoded.baseAmountIn.toString('hex'))}`);
    console.log(`Quote Amount In: ${hexToDecimal(decoded.quoteAmountIn.toString('hex'))}`);
    console.log(`Fixed Side: ${decoded.fixedSide === 0 ? 'Base' : 'Quote'}`);

    return decoded;
}

// Decoding function for Remove Liquidity
function decodeRemoveLiquidityInstruction(data) {
    const buffer = Buffer.from(bs58.decode(data));
    const decoded = borsh.deserialize(removeLiquiditySchema, RemoveLiquidityInstruction, buffer);

    console.log("Decoded Remove Liquidity Instruction:");
    console.log(`Instruction: ${decoded.instruction}`);
    console.log(`Amount In: ${hexToDecimal(decoded.amountIn.toString('hex'))}`);

    return decoded;
}

// Decode instruction data based on Raydium instruction types
function decodeInstructionData(data) {
    // Example logic to differentiate between different types of instructions
    if (data.includes('someAddLiquidityIdentifier')) {
        return decodeAddLiquidityInstruction(data);
    } else if (data.includes('someRemoveLiquidityIdentifier')) {
        return decodeRemoveLiquidityInstruction(data);
    }

    return null;
}

// Process and store the transaction
async function processRaydiumLpTransaction(connection, signature) {
    try {
        const transactionDetails = await connection.getTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
        });

        if (transactionDetails) {
            const message = transactionDetails.transaction.message;
            const accounts = message.staticAccountKeys.map(key => key.toString());

            console.log("Transaction Message:", message);
            console.log("Accounts:", accounts);

            if (Array.isArray(message.instructions)) {
                for (const ix of message.instructions) {
                    const programId = message.staticAccountKeys[ix.programIdIndex].toString();

                    if (programId === process.env.RAYDIUM_AMM_PROGRAM_ID) {
                        const decodedInstruction = decodeInstructionData(ix.data);

                        if (decodedInstruction && (decodedInstruction.instruction === 'CreatePool' || decodedInstruction.instruction === 'InitializeInstruction2')) {
                            console.log("CreatePool instruction found!");

                            const ammId = message.staticAccountKeys[ix.accounts[0]].toString();
                            const ammAuthority = message.staticAccountKeys[ix.accounts[1]].toString();
                            const openOrders = message.staticAccountKeys[ix.accounts[2]].toString();
                            const vaultA = message.staticAccountKeys[ix.accounts[3]].toString();
                            const vaultB = message.staticAccountKeys[ix.accounts[4]].toString();
                            const lpMint = message.staticAccountKeys[ix.accounts[5]].toString();
                            const coinMint = message.staticAccountKeys[ix.accounts[6]].toString();
                            const pcMint = message.staticAccountKeys[ix.accounts[7]].toString();
                            const liquidityAmount = await connection.getBalance(new PublicKey(coinMint)) / 1e9;

                            console.log(`Liquidity Pool Amount (In SOL): ${liquidityAmount}`);

                            const tokenData = {
                                ammId: new PublicKey(ammId),
                                ammAuthority: new PublicKey(ammAuthority),
                                lpMint: new PublicKey(lpMint),
                                coinMint: new PublicKey(coinMint),
                                pcMint: new PublicKey(pcMint),
                                liquidityAmount: liquidityAmount,
                                openOrders: new PublicKey(openOrders),
                                vaultA: new PublicKey(vaultA),
                                vaultB: new PublicKey(vaultB)
                            };

                            // Store both test message and event details in MongoDB
                            const eventDetails = {
                                signature,
                                instructionType: decodedInstruction.instruction,
                                timestamp: new Date(),
                                decodedInstruction: decodedInstruction,
                                liquidityAmount: liquidityAmount,
                                ammId: ammId,
                                ammAuthority: ammAuthority,
                                openOrders: openOrders,
                                vaultA: vaultA,
                                vaultB: vaultB,
                                lpMint: lpMint,
                                coinMint: coinMint,
                                pcMint: pcMint,
                                // Add any additional fields you want here
                                test: "BBC, why isn't this fuckingshit working"  // Including test message
                            };

                            console.log("Event Details:", eventDetails);

                            await db.collection('Test1').insertOne(eventDetails);
                            console.log("Event inserted into MongoDB");

                            return tokenData;
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error("Error fetching/processing transaction:", error.message);
    }

    return null;
}

module.exports = {
    connectToDatabase,
    processRaydiumLpTransaction
};
