/// Standard non-overlapping 2.4 GHz WiFi channels used for hackathon
/// frequency-hopping demonstration.
pub fn default_channels() -> Vec<u8> {
    vec![1, 6, 11]
}

/// Select the channel for a given hop index within a burst sub-slot.
#[allow(dead_code)]
pub fn channel_for_hop(hop_index: usize, base_channels: &[u8]) -> u8 {
    base_channels[hop_index % base_channels.len()]
}

/// Derive a per-node, per-cycle hop sequence from a seed.
/// In production this uses HKDF(shared_secret, node_id || cycle || slot).
/// For the hackathon, a simple deterministic shuffle suffices.
pub fn hop_sequence(node_id: u16, cycle: u64, slot: u16, channels: &[u8]) -> Vec<u8> {
    if channels.is_empty() {
        return vec![];
    }
    let mut seq = channels.to_vec();
    // Deterministic Fisher-Yates using a seed derived from node_id, cycle, slot
    let mut seed: u64 = u64::from(node_id)
        .wrapping_mul(2654435761)
        .wrapping_add(cycle.wrapping_mul(40503))
        .wrapping_add(u64::from(slot).wrapping_mul(12345));
    for i in (1..seq.len()).rev() {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let j = (seed >> 33) as usize % (i + 1);
        seq.swap(i, j);
    }
    seq
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_channels_are_non_overlapping() {
        let ch = default_channels();
        assert_eq!(ch, vec![1, 6, 11]);
    }

    #[test]
    fn channel_for_hop_wraps_around() {
        let ch = vec![1, 6, 11];
        assert_eq!(channel_for_hop(0, &ch), 1);
        assert_eq!(channel_for_hop(1, &ch), 6);
        assert_eq!(channel_for_hop(2, &ch), 11);
        assert_eq!(channel_for_hop(3, &ch), 1);
    }

    #[test]
    fn hop_sequence_is_deterministic() {
        let ch = default_channels();
        let seq1 = hop_sequence(7, 100, 3, &ch);
        let seq2 = hop_sequence(7, 100, 3, &ch);
        assert_eq!(seq1, seq2);
    }

    #[test]
    fn hop_sequence_varies_with_inputs() {
        let ch = default_channels();
        let a = hop_sequence(1, 100, 3, &ch);
        let b = hop_sequence(2, 100, 3, &ch);
        let c = hop_sequence(1, 101, 3, &ch);
        // At least one pair should differ (with overwhelming probability)
        assert!(a != b || a != c);
    }

    #[test]
    fn hop_sequence_contains_all_channels() {
        let ch = default_channels();
        let seq = hop_sequence(42, 999, 0, &ch);
        assert_eq!(seq.len(), ch.len());
        for c in &ch {
            assert!(seq.contains(c));
        }
    }
}
