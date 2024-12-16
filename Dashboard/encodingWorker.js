// encodingWorker.js

// Listen for messages from the main thread
self.onmessage = function (e) {
    const { algorithm, imageData } = e.data;
    let outputData = null;
    let originalSize = 0;
    let compressedSize = 0;

    try {
        switch (algorithm) {
            case 'Run Length Encoding':
                const compressedRLE = runLengthEncoding(imageData);
                outputData = decompressRLE(compressedRLE, imageData.width, imageData.height);

                // Calculate compression details
                originalSize = imageData.data.length * 8; // bits
                compressedSize = compressedRLE.length * 32; // assuming 32 bits per run
                break;

            case 'Huffman Encoding':
                const { encodedData, huffmanTree } = huffmanEncoding(imageData);
                const decodedData = decodeHuffman(encodedData, huffmanTree, imageData.width, imageData.height);
                outputData = decodedData;

                // Calculate compression details
                originalSize = imageData.data.length * 8; // bits
                compressedSize = encodedData.length; // bits
                break;

            case 'Arithmetic Encoding':
                const { bitstream, frequencies } = arithmeticEncoding(imageData);
                const decodedArithmetic = arithmeticDecoding(bitstream, frequencies, imageData.width, imageData.height);
                outputData = decodedArithmetic;

                // Calculate compression details
                originalSize = imageData.data.length * 8; // bits
                compressedSize = bitstream.length; // bits
                break;

            case 'Compression':
                const compressed = compressRLE(imageData);
                outputData = decompressRLE(compressed, imageData.width, imageData.height);

                // Calculate compression details
                originalSize = imageData.data.length * 8; // bits
                compressedSize = compressed.length * 32; // assuming 32 bits per run
                break;

            default:
                throw new Error('Unsupported algorithm.');
        }

        // Post the result back to the main thread with structured data
        self.postMessage({ outputData, originalSize, compressedSize });
    } catch (error) {
        self.postMessage({ error: error.message });
    }
};

// Run Length Encoding
function runLengthEncoding(inputData) {
    const compressedData = [];
    let count = 1;

    for (let i = 4; i < inputData.data.length; i += 4) {
        if (
            inputData.data[i] === inputData.data[i - 4] &&
            inputData.data[i + 1] === inputData.data[i - 3] &&
            inputData.data[i + 2] === inputData.data[i - 2] &&
            inputData.data[i + 3] === inputData.data[i - 1]
        ) {
            count++;
        } else {
            compressedData.push({ pixel: Array.from(inputData.data.slice(i - 4, i)), count });
            count = 1;
        }
    }
    compressedData.push({ pixel: Array.from(inputData.data.slice(-4)), count }); // Push last run

    return compressedData;
}

// Decompress Run Length Encoding
function decompressRLE(compressedData, width, height) {
    const output = {
        data: new Uint8ClampedArray(width * height * 4),
        width: width,
        height: height
    };
    let i = 0;

    compressedData.forEach(run => {
        for (let j = 0; j < run.count; j++) {
            if (i >= width * height) break; // Prevent overflow
            const pixel = run.pixel;
            output.data.set(pixel, i * 4);
            i++;
        }
    });

    return output;
}

// Huffman Encoding
function huffmanEncoding(inputData) {
    const frequencies = new Map();

    // Step 1: Calculate frequency of each pixel value
    for (let i = 0; i < inputData.data.length; i += 4) {
        const key = `${inputData.data[i]}_${inputData.data[i + 1]}_${inputData.data[i + 2]}_${inputData.data[i + 3]}`;
        frequencies.set(key, (frequencies.get(key) || 0) + 1);
    }

    // Step 2: Build Huffman Tree
    const heap = [...frequencies.entries()].map(([key, freq]) => ({ key, freq, left: null, right: null }));
    while (heap.length > 1) {
        heap.sort((a, b) => a.freq - b.freq);
        const left = heap.shift();
        const right = heap.shift();
        heap.push({ key: null, freq: left.freq + right.freq, left, right });
    }
    const huffmanTree = heap[0];

    // Step 3: Generate Huffman codes
    const huffmanCodes = {};
    const generateCodes = (node, code) => {
        if (node.key) {
            huffmanCodes[node.key] = code;
        } else {
            generateCodes(node.left, code + '0');
            generateCodes(node.right, code + '1');
        }
    };
    generateCodes(huffmanTree, '');

    // Step 4: Encode the data
    let encodedData = '';
    for (let i = 0; i < inputData.data.length; i += 4) {
        const key = `${inputData.data[i]}_${inputData.data[i + 1]}_${inputData.data[i + 2]}_${inputData.data[i + 3]}`;
        encodedData += huffmanCodes[key];
    }

    return { encodedData, huffmanTree };
}

// Decode Huffman Encoding
function decodeHuffman(encodedData, huffmanTree, width, height) {
    const output = {
        data: new Uint8ClampedArray(width * height * 4),
        width: width,
        height: height
    };
    let node = huffmanTree;
    let i = 0;

    for (let bit of encodedData) {
        node = bit === '0' ? node.left : node.right;
        if (node.key) {
            const [r, g, b, a] = node.key.split('_').map(Number);
            if (i < width * height) {
                output.data[i * 4] = r;
                output.data[i * 4 + 1] = g;
                output.data[i * 4 + 2] = b;
                output.data[i * 4 + 3] = a;
                i++;
            }
            node = huffmanTree;
        }
    }

    return output;
}

// Arithmetic Encoding
function arithmeticEncoding(inputData) {
    const frequencies = new Map();

    // Step 1: Calculate frequency of each pixel value
    for (let i = 0; i < inputData.data.length; i += 4) {
        const key = `${inputData.data[i]}_${inputData.data[i + 1]}_${inputData.data[i + 2]}_${inputData.data[i + 3]}`;
        frequencies.set(key, (frequencies.get(key) || 0) + 1);
    }

    // Step 2: Calculate cumulative frequencies
    const sortedKeys = Array.from(frequencies.keys()).sort();
    const cumulativeFrequencies = new Map();
    let cumulative = 0;
    sortedKeys.forEach(key => {
        cumulativeFrequencies.set(key, cumulative);
        cumulative += frequencies.get(key);
    });

    const totalSymbols = inputData.data.length / 4;
    let low = 0.0;
    let high = 1.0;
    let range;

    let bitstream = '';

    for (let i = 0; i < inputData.data.length; i += 4) {
        const key = `${inputData.data[i]}_${inputData.data[i + 1]}_${inputData.data[i + 2]}_${inputData.data[i + 3]}`;
        const freq = frequencies.get(key);
        const cumProbLow = cumulativeFrequencies.get(key) / totalSymbols;
        const cumProbHigh = (cumulativeFrequencies.get(key) + freq) / totalSymbols;

        range = high - low;
        high = low + range * cumProbHigh;
        low = low + range * cumProbLow;

        // Emit bits while high and low share the same leading bit
        while (true) {
            if (high <= 0.5) {
                bitstream += '0';
                low = low * 2;
                high = high * 2;
            } else if (low >= 0.5) {
                bitstream += '1';
                low = (low - 0.5) * 2;
                high = (high - 0.5) * 2;
            } else {
                break;
            }
        }
    }

    // Final bits
    if (low < 0.5) {
        bitstream += '0';
    } else {
        bitstream += '1';
    }

    return { bitstream, frequencies };
}

// Arithmetic Decoding
function arithmeticDecoding(bitstream, frequencies, width, height) {
    const output = {
        data: new Uint8ClampedArray(width * height * 4),
        width: width,
        height: height
    };
    const totalSymbols = width * height;

    // Step 1: Calculate cumulative frequencies
    const sortedKeys = Array.from(frequencies.keys()).sort();
    const cumulativeFrequencies = [];
    let cumulative = 0;
    sortedKeys.forEach(key => {
        cumulativeFrequencies.push({ key, cumLow: cumulative / totalSymbols, cumHigh: (cumulative + frequencies.get(key)) / totalSymbols });
        cumulative += frequencies.get(key);
    });

    // Step 2: Initialize low and high
    let low = 0.0;
    let high = 1.0;
    let range;

    // Step 3: Initialize the bitstream
    let encodedValue = 0.0;
    const bits = bitstream.split('');
    for (let i = 0; i < bits.length; i++) {
        encodedValue += parseInt(bits[i]) * Math.pow(2, -(i + 1));
    }

    for (let i = 0; i < totalSymbols; i++) {
        range = high - low;
        const value = (encodedValue - low) / range;

        // Find the corresponding symbol
        let symbol = null;
        for (let entry of cumulativeFrequencies) {
            if (value >= entry.cumLow && value < entry.cumHigh) {
                symbol = entry.key;
                break;
            }
        }

        if (symbol === null) {
            console.warn(`Symbol not found for value ${value}`);
            break;
        }

        // Set pixel data
        const [r, g, b, a] = symbol.split('_').map(Number);
        output.data[i * 4] = r;
        output.data[i * 4 + 1] = g;
        output.data[i * 4 + 2] = b;
        output.data[i * 4 + 3] = a;

        // Update low and high
        const entry = cumulativeFrequencies.find(e => e.key === symbol);
        low = low + range * entry.cumLow;
        high = low + range * (entry.cumHigh - entry.cumLow);
    }

    return output;
}

// Compression using Run Length Encoding
function compressRLE(inputData) {
    // Reduce color depth (quantize colors)
    const quantizedData = new Uint8ClampedArray(inputData.data.length);
    for (let i = 0; i < inputData.data.length; i += 4) {
        quantizedData[i] = Math.round(inputData.data[i] / 32) * 32; // Red
        quantizedData[i + 1] = Math.round(inputData.data[i + 1] / 32) * 32; // Green
        quantizedData[i + 2] = Math.round(inputData.data[i + 2] / 32) * 32; // Blue
        quantizedData[i + 3] = inputData.data[i + 3]; // Alpha remains the same
    }

    // Now apply Run-Length Encoding (RLE)
    const compressedData = runLengthEncoding({ data: quantizedData, width: inputData.width, height: inputData.height });

    return compressedData; // Return compressed data
}

// Helper function to clamp color values between 0 and 255
function clamp(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
}
