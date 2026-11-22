using System.Buffers.Binary;
using System.Security.Cryptography;

namespace OsuSkinMixer;

/// <summary>
/// The stand-ins used when a part of the skin is set to "none": an invisible image and a silent sample.
/// lazer only falls back to its own skin for files which are missing, so hiding something means providing these.
/// </summary>
public static class BlankFiles
{
    /// <summary>A fully transparent 1x1 PNG.</summary>
    public static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=");

    /// <summary>
    /// 10ms of silence. Not quite zero-length: audio decoders can reject a sample with no data at all,
    /// and a rejected sample is not guaranteed to stay silent.
    /// </summary>
    public static readonly byte[] Wav = createSilence(sampleRate: 44100, samples: 441);

    public static readonly string PngHash = Convert.ToHexStringLower(SHA256.HashData(Png));
    public static readonly string WavHash = Convert.ToHexStringLower(SHA256.HashData(Wav));

    public static byte[]? Get(string hash) => hash == PngHash ? Png : hash == WavHash ? Wav : null;

    private static byte[] createSilence(int sampleRate, int samples)
    {
        int dataLength = samples * 2;
        byte[] wav = new byte[44 + dataLength];
        var span = wav.AsSpan();

        "RIFF"u8.CopyTo(span);
        BinaryPrimitives.WriteInt32LittleEndian(span[4..], 36 + dataLength);
        "WAVEfmt "u8.CopyTo(span[8..]);
        BinaryPrimitives.WriteInt32LittleEndian(span[16..], 16); // format chunk length
        BinaryPrimitives.WriteInt16LittleEndian(span[20..], 1); // PCM
        BinaryPrimitives.WriteInt16LittleEndian(span[22..], 1); // mono
        BinaryPrimitives.WriteInt32LittleEndian(span[24..], sampleRate);
        BinaryPrimitives.WriteInt32LittleEndian(span[28..], sampleRate * 2); // bytes per second
        BinaryPrimitives.WriteInt16LittleEndian(span[32..], 2); // bytes per frame
        BinaryPrimitives.WriteInt16LittleEndian(span[34..], 16); // bits per sample
        "data"u8.CopyTo(span[36..]);
        BinaryPrimitives.WriteInt32LittleEndian(span[40..], dataLength);

        return wav;
    }
}
