#!/usr/bin/env bash
# Download the CC0 samples that score.py plays into public/music/samples (gitignored), pinned to the upstream
# commits listed in samples.md and checked against their git blob hashes.
#
# usage: scripts/music/fetch-samples.sh [--force]   (from apps/videos; --force re-downloads files already there)
set -euo pipefail
cd "$(dirname "$0")/../.."
DEST=public/music/samples
FORCE=${1:-}

repo() {  # library prefix -> owner/name@commit
  case "$1" in
    vsco) echo "sgossner/VSCO-2-CE@440300901dfe9275fd84e0b7763af1f8443ae62e" ;;
    vcsl) echo "sgossner/VCSL@c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e" ;;
    mck) echo "MckAudio/MckSamplePacks@5db40e8fe26785c256845a5bb38921b2654a887f" ;;
    *) echo "unknown library $1" >&2; exit 1 ;;
  esac
}

manifest() {  # git blob sha, then the path under public/music/samples (library prefix + upstream path)
  cat <<'LIST'
00a9f623324538a93e90e2bdfc5c24b8b27cb06d  vsco/Brass/Tenor Trombone/stac/tenortbn_stac_F2_v3_rr2.wav
00eecfab16c3bab05a5b84b8671316b76013da0a  vsco/Percussion/cymbal-crash1_ff_rr2.wav
01719dfe7beb254f6f16dccb8d56a906c41316c4  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F4_v2_rr2.wav
020341b6f206e571211e240e544f2bc314215553  vsco/Percussion/Timpani/Timpani3_Hit_v4_rr1_Sum.wav
02778411d215601a2de99ac1a7210cc9a5eb32e6  vsco/Percussion/susCymb1-cresc-Short_v1.wav
045be34ec05a829f38d42cb643c4d1cda70e9cd0  vcsl/Idiophones/Struck Idiophones/Claps/Clap_rr3.wav
059a10515dc4ed409dfea126cff0e0a1b46cd3a7  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_C5_v3_rr1.wav
062bd5ceb829abd2738f09b14594a98c8d05b5de  vcsl/Idiophones/Struck Idiophones/Slapstick/slapstick_rr2.wav
08332f4a528dcdeb208a8081b39136778562adcb  vcsl/Membranophones/Struck Membranophones/Tom 1/Stick/TomH_HitS_v4_rr1_Mid.wav
0b6142ebe63a7f86763391286ef44ec66f26ac7c  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_G3_v2_rr1.wav
0c64406f6cfacac35e83670215fe84988eb2862d  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F4_v3_rr1.wav
0cbed0b3f735964ccd62352e0329d280d095c1e3  vsco/Brass/F Horn/stac/MOHorn_stac_F2_v2_rr2.wav
102f740d546c8f147847ea4243b7c75b6eaa3119  vsco/Percussion/Snare2-HitSN_v5_rr1_Sum.wav
115831a85bc1b2856cb1ac55f0727917df83641d  vcsl/Idiophones/Struck Idiophones/Slapstick/slapstick_rr3.wav
15d871a42884a9a6c8300021790e94a38a9c297b  vsco/Brass/Tenor Trombone/stac/tenortbn_stac_F2_v3_rr1.wav
1ccb564b7564df62ac16af6947e1216489730941  vsco/Brass/Tenor Trombone/stac/tenortbn_stac_F2_v4_rr1.wav
1fe4faa5848826fd908cadf9aad81bad090a5e18  vsco/Brass/F Horn/stac/MOHorn_stac_F2_v3_rr2.wav
2087047717d10850a622600ca73ac34799653413  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D#3_v2_rr2.wav
25739527f54e1a2f1bea670cdf3eece04f414946  vcsl/Idiophones/Struck Idiophones/Woodblock/wood_click_f_rr2.wav
282b1bf9c727c8a755daaedcd546e9fe887a6ba8  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D4_v2_rr2.wav
2c188f201871e088c649fbf5701f8ae2d7fa2c73  vsco/Percussion/gongHit_fff.wav
2c25cd11c6f8d8c1dbec501fd1c693aa6739c1fa  vsco/Percussion/cymbal-crash1_ff_rr1.wav
2cde793a0c0b3e1657ec07b7dc03395eb39d1c84  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F4_v2_rr1.wav
2d1c3921045d4c2d6148a9a16e764e2bfdfc6cd7  vsco/Percussion/Snare2-HitSN_v7_rr1_Sum.wav
2da16b369ecc935ce024f1250afc4fb2dc151eb6  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A#3_v2_rr1.wav
2f986209e0ed7bffdcc000260ef9df60e6674a69  vcsl/Membranophones/Struck Membranophones/Snare Drum, Rope Tension/RopeSnare_stick_Main_vl1_rr1.wav
30ccff6f19012dc772f805beb172f0dd7fabf2e6  vsco/Brass/Tuba/stac/Tuba3_stac_F1_v2_rr3_Sum.wav
371b3c89b59fa63405e0e1e8909ae473104a3049  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_C5_v3_rr2.wav
37e4efffdbe853674f4e351c2b8bf74d1b11df42  vsco/Brass/Tuba/sus/Tuba3_sus_F0_v1_rr1_Mid.wav
3806b91e69df67b6c065fe80fd629df65b5391d4  vsco/Brass/Tenor Trombone/stac/tenortbn_stac_D3_v4_rr1.wav
3e1d8c464a54b7a070d0ef7380a408fd06c5e0c9  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F3_v3_rr2.wav
3e2525a304ec4894d7adb477d2e8134d46b6a3b1  vsco/Brass/Tuba/stac/Tuba3_stac_F1_v2_rr2_Sum.wav
3e581ffda8f01a633c045f7181474368f100d11f  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_G3_v3_rr2.wav
403be9ea239d244971f7bc0130a8756c88d28640  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F3_v2_rr1.wav
41d7027fa1c4424e6af5e7a2f3981d5397759814  vcsl/Idiophones/Struck Idiophones/Claps/Clap_rr6.wav
427677a8e7fe48b551ef171c64cfb1414a49550b  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D#3_v3_rr2.wav
438317aa2749f404ac921a3676c5ea5e5bf0b78d  vcsl/Idiophones/Struck Idiophones/Claps/Clap_rr4.wav
48a91912f81a27d4a474a360703ff3d8c4612280  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F3_v2_rr2.wav
514ef9e3ed8af70249af397b2cb59aa86259b3ab  mck/TR8/BD/004_909_Bass_Drum_1.wav
52f58161c3944d30fb5598144697650b29224947  vsco/Brass/Tenor Trombone/sus/tenortbn_sus_A#1_v3_1.wav
53ef5d48ac2c8263da2f6e70f73302e84e520227  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_G3_v3_rr1.wav
56fd03961972f3b2a8c894cbe9256b376ca1eb0c  vsco/Brass/Tenor Trombone/stac/tenortbn_stac_A#2_v3_rr2.wav
5a2c37217f7cdb9125142ab5b05dcd41a20e5be2  vsco/Brass/Tuba/stac/Tuba3_stac_D#1_v2_rr2_Sum.wav
5b5082d93eade6e6b4307b6e0ab75fe4e27501e4  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F3_v3_rr1.wav
5e3664e122ad9321309f2c4476ff9de4444c908b  vsco/Brass/Tuba/stac/Tuba3_stac_F1_v2_rr4_Sum.wav
62314550a35397a36afe9cc4bd8e21f7ae93a191  mck/TR8/HATS/009_909_Open_HiHat_Short.wav
636face9d16c505ef6038bf42035f4cfb57ffe3b  vcsl/Membranophones/Struck Membranophones/Snare Drum, Rope Tension/Hi/RopeSnare_hi_sn_Main_vl4_rr1.wav
63efbcb5542a4477c4d53379583d4c7907daf90e  vsco/Percussion/Timpani/Rolls/Timpani1_Roll_v5_rr1_Sum.wav
688419e623c8022563d8b1880e2ab5fc4aa93bf9  vsco/Brass/Tenor Trombone/stac/tenortbn_stac_D3_v4_rr2.wav
6a8e9210be8110d882d8802b6220a5fabc700f14  vsco/Brass/F Horn/stac/MOHorn_stac_A2_v2_rr1.wav
6d312fa649c6bb8bed53fd9d5b5d8f4d0e7c03b1  vsco/Brass/F Horn/stac/MOHorn_stac_F2_v2_rr1.wav
6ff7612abefebbfe086f87a843d89492b3c08d78  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_G3_v2_rr2.wav
73a0b9f07af11d3e2404a652e0d66c3a7c8aebab  vsco/Brass/Tuba/sus/Tuba3_sus_F1_v3_rr1_Mid.wav
74d14ae56377ebe03606b810a70250809a1c1e19  vcsl/Idiophones/Struck Idiophones/Claps/Clap_rr2.wav
756e786aeabfe7b27f1b66c212ce824d5608de4e  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A4_v3_rr1.wav
77d17d832af6f646de8b2cb2e2793f87e939076f  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D#3_v3_rr1.wav
79a388f22dc8241f6e9e0c98937a83bfa1f80658  vcsl/Idiophones/Struck Idiophones/Woodblock/wood_click3_vl2.wav
80d482935d4b79a80938c30dc6f083bfe206e9be  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D4_v2_rr1.wav
81272129a1b36a49bf14cb044944cba081923699  vsco/Brass/F Horn/stac/MOHorn_stac_A2_v3_rr1.wav
815560ece9f2e8d0ad6a33ba24a014345ea59814  vsco/Brass/Trumpet/sus/Sum_SHTrumpet_sus_D4_v3_rr1.wav
816cb43dc8f09ad900246dd00a4880a3d62c310c  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A4_v3_rr2.wav
851ec71255d3e0bda54a4994e5740a643064f10f  mck/TR8/PERC/019_909_Hand_Clap.wav
85b5ca4aa4d8afc41ac70556888159906847cafa  vcsl/Membranophones/Struck Membranophones/Snare Drum, Rope Tension/Hi/RopeSnare_hi_sn_Main_vl2_rr1.wav
86b845ae3d94c6e8213b61364a37c318904efc00  vsco/Brass/Tenor Trombone/stac/tenortbn_stac_F2_v4_rr2.wav
86d8e078c8820d49fd15124fe037cbd667ae8fa2  vsco/Percussion/Timpani/Timpani1_Hit_v3_rr1_Sum.wav
87d4aee035e4ac29ebca2787048594c059509962  vsco/Percussion/Snare2-HitSN_v7_rr2_Sum.wav
87e437363c9893fbbe10a70cf9edec17bce2907f  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D4_v3_rr2.wav
8d68825cf75741d32d75bd182130bb6ebb0bf3e9  vsco/Brass/Tenor Trombone/stac/tenortbn_stac_A#2_v4_rr1.wav
8dc8428dc7a7e3da2ab0dfbd0579140275561504  vsco/Brass/F Horn/stac/MOHorn_stac_A2_v3_rr2.wav
8fc2e2576a5a3b03054d7e95adb387f520a469fe  mck/TR8/HATS/007_909_Open_HiHat.wav
93ebf3571cef69c65ba1acba1d746e5bfa6c7db8  vsco/Percussion/BDrumNewhit_v7_rr1_Sum.wav
950438ecb7217d5a4a6d0c8af6d814a92ab5be0e  vsco/Brass/Tuba/stac/Tuba3_stac_D#1_v2_rr1_Sum.wav
98bc7d3d4709c8d7a240a1f39c615bef3af7e5b0  vsco/Brass/F Horn/sus/MOHorn_sus_C3_v4_1.wav
9947fab6818aebb2977c473e964088638b02ff14  vsco/Brass/Tenor Trombone/stac/tenortbn_stac_A#1_v4_rr1.wav
a301819024fe8d1fb8cdf86f9b5d0d8121c8c073  vsco/Brass/Trumpet/sus/Sum_SHTrumpet_sus_G3_v3_rr1.wav
a3d2dce8d8334444818a2c7403f0964ea3aa5122  vsco/Brass/Tuba/stac/Tuba3_stac_D#1_v2_rr4_Sum.wav
a5a1cfbe2d2a1287893b29a2f6c3ddef44c751d3  vcsl/Membranophones/Struck Membranophones/Tom 1/Stick/TomH_HitS_v4_rr2_Mid.wav
a88c16c3a48afb44991c1b2d99fb1394195161f7  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D#3_v2_rr1.wav
a91b32be153b69d65c46f5be1e38310c70353661  vsco/Brass/Tenor Trombone/sus/tenortbn_sus_C3_v3_1.wav
aa54df144b4bc892fe68cf6fd8519d60898b5362  vsco/Brass/Tuba/stac/Tuba3_stac_D#1_v2_rr3_Sum.wav
af9345753c5b31083a3e344dd7bbf6c978de59c3  vsco/Brass/F Horn/sus/MOHorn_sus_F2_v3_1.wav
b23c4741a106b8d7316516b2db6c4c976e44374b  vsco/Brass/F Horn/stac/MOHorn_stac_A2_v2_rr2.wav
b449ea581cb7bb5722e7e0a07df342e2c1bd0de4  vsco/Percussion/Snare2-HitSN_v5_rr2_Sum.wav
b76f283f9fffd4ad4d32689424e8562292021791  vsco/Percussion/BDrumNewhit_v7_rr2_Sum.wav
b7f76652558f4b2bc8065424e9e8b119859deb8d  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A#3_v3_rr1.wav
bbdc0773c636c611b953ed1383f8cf1eb6b53b38  vsco/Brass/Trumpet/sus/Sum_SHTrumpet_sus_A4_v3_rr1.wav
be315404c5fafc92dd9a064607db00c488f369e4  vsco/Brass/F Horn/stac/MOHorn_stac_F2_v3_rr1.wav
bf2e9183f32a0f422ef48d7adc88a8916ea29f94  vcsl/Idiophones/Struck Idiophones/Slapstick/slapstick_rr1.wav
bf422133f0024a4e41889734f843723efcb4144a  vcsl/Idiophones/Struck Idiophones/Claps/Clap_rr5.wav
bf84f488eff51c1baa130a096c75ce7b52e1d1d4  mck/TR8/HATS/010_909_Closed_HiHat_Short.wav
c0822dbc84bbecbf671165b3731b8afeccadf088  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A4_v2_rr2.wav
c39c5e8c2acff7e954a5446603c310e238efc70d  vsco/Percussion/Snare2-HitSN_v9_rr1_Sum.wav
c6164474bad88e9d7718358a669ba076d825fff7  vsco/Brass/Tenor Trombone/sus/tenortbn_sus_F3_v3_1.wav
c713805a6c02679c4f141de8971dfce8afa51d74  vsco/Brass/F Horn/stac/MOHorn_stac_D2_v3_rr2.wav
cb508c5bf2e3c21dc3441194499fc6d0e7344f4b  vsco/Brass/Trumpet/sus/Sum_SHTrumpet_sus_F4_v3_rr1.wav
cb97ac413666687d63624c704e832b4196e0ddd6  vsco/Brass/Tenor Trombone/sus/tenortbn_sus_D#3_v3_1.wav
cbf6e82c288c8ab80c52599ffb60d61ec9751adf  mck/TR8/HATS/008_909_Closed_HiHat.wav
ce149164e8a227ffbe3adfbed37181223dbe05d2  vsco/Brass/Tenor Trombone/stac/tenortbn_stac_A#2_v3_rr1.wav
d323f7ba3db673b459f94b23175e9305a5a2995d  vsco/Brass/Tenor Trombone/stac/tenortbn_stac_A#1_v4_rr2.wav
d4088d29905d60944c524d443f66c55035301e47  vsco/Brass/F Horn/sus/MOHorn_sus_A2_v3_1.wav
d46fa53c16a3add22369c3c07cc965eaaf583d71  vsco/Brass/Tuba/sus/Tuba3_sus_D#1_v3_rr1_Mid.wav
d6a5165f419819413bf907b65c2bec795ba864db  vsco/Brass/F Horn/stac/MOHorn_stac_D2_v2_rr1.wav
df3b1287a88e26172ef1c5d83f0b12a08cf30e07  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A#3_v3_rr2.wav
df7df76b2dc43e31e2848b5942b91ffcc4da6548  vsco/Brass/Tenor Trombone/stac/tenortbn_stac_A#2_v4_r2.wav
dfb869ad2e91b4fca51c017c7517c1bbf9958ce6  vsco/Brass/Tenor Trombone/sus/tenortbn_sus_C#3_v3_1.wav
e033dc2c58e13d3edcb7a61bd6f1bc90310562ae  vcsl/Idiophones/Struck Idiophones/Claps/Clap_rr1.wav
e61e2d828400580fd267e5af934eee65e62d21b7  vsco/Brass/F Horn/sus/MOHorn_sus_D2_v4_1.wav
e677f48530d9715c1e8ebbd35e1795de9e7ea207  vsco/Percussion/Timpani/Timpani4_Hit_v4_rr1_Sum.wav
e756e2573b1112d1c0a182ffedb71237006e8ff9  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A4_v2_rr1.wav
e8363c0ab182b9eae55c3d79f855f67ca585b08f  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_F4_v3_rr2.wav
ebb78e98cacebf05e2016b9a244ce0f4481a9621  vsco/Brass/F Horn/stac/MOHorn_stac_D2_v2_rr2.wav
ee1eace963e4bceaa70c84b6a0f6cbd67cfacb21  vsco/Brass/Tuba/stac/Tuba3_stac_F1_v2_rr1_Sum.wav
ee846604e1c6850582d6aad3d4cd9983e1c73d49  vcsl/Idiophones/Struck Idiophones/Woodblock/wood_click_f_rr1.wav
eed06e0833c95cf381ec231b1d737e2eba82d14f  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_A#3_v2_rr2.wav
eef36ce79c6497eacde16aca18edbfbd0418e837  vsco/Brass/Tenor Trombone/sus/tenortbn_sus_D2_v3_1.wav
f1fe8074459f0c37f6212f296f299ff4416da09c  vsco/Brass/Trumpet/stac/Sum_SHTrumpet_stac_D4_v3_rr1.wav
f6564fe9bd3d498859c84e0395c3f0d97443a061  vsco/Percussion/Snare2-HitSN_v9_rr2_Sum.wav
f6b2753da2ae19e4748a91b0ed412decf3973fda  vsco/Brass/Trumpet/sus/Sum_SHTrumpet_sus_A#3_v3_rr1.wav
f6c1025383f62db27083c3cb78d5046d748ada4c  vsco/Brass/Tenor Trombone/sus/tenortbn_sus_F2_v3_1.wav
f7c9a73161cf5096507c550f87f04afd491bee98  vsco/Brass/F Horn/stac/MOHorn_stac_C3_v3_rr2.wav
f86313efe12277b893333660a562a1f3d4ef0afc  vsco/Brass/F Horn/stac/MOHorn_stac_D2_v3_rr1.wav
fd83d80d30acbc11ee83642866c1f7d293bedc63  vcsl/Membranophones/Struck Membranophones/Snare Drum, Rope Tension/Hi/RopeSnare_hi_sn_Main_vl3_rr1.wav
LIST
}

config=$(mktemp)
trap 'rm -f "$config"' EXIT
n=0
while IFS= read -r line; do
  file=${line#*  }
  [ -n "$FORCE" ] || [ ! -f "$DEST/$file" ] || continue
  lib=${file%%/*}
  rel=${file#*/}
  r=$(repo "$lib")
  enc=${rel// /%20}
  enc=${enc//#/%23}
  enc=${enc//,/%2C}
  printf 'url = "https://raw.githubusercontent.com/%s/%s/%s"\noutput = "%s/%s"\n' "${r%@*}" "${r#*@}" "$enc" "$DEST" "$file" >> "$config"
  n=$((n + 1))
done < <(manifest)

if [ "$n" -gt 0 ]; then
  echo "downloading $n samples into $DEST"
  curl --fail --silent --show-error --location --retry 3 --create-dirs --parallel --parallel-max 8 --config "$config"
fi

bad=0
while IFS= read -r line; do
  sha=${line%%  *}
  file=${line#*  }
  if [ "$(git hash-object "$DEST/$file")" != "$sha" ]; then
    echo "checksum mismatch: $DEST/$file" >&2
    bad=1
  fi
done < <(manifest)
[ "$bad" -eq 0 ] && echo "$(manifest | wc -l | tr -d ' ') samples present and verified in $DEST"
exit "$bad"
