pub mod doku;
pub mod gfx;
pub mod harita;
pub mod model;
pub mod modlar;
pub mod oiv;
pub mod rpf;
pub mod rsc;
pub mod vs;
pub mod ypt;
pub mod ytd;

#[derive(Debug, thiserror::Error)]
pub enum Hata {
    #[error("RPF7 arşivi değil")]
    RpfDegil,
    #[error("{0} şifreli arşiv, yalnız OPEN/CFXP arşivler düzenlenebilir")]
    Sifreli(&'static str),
    #[error("bozuk veri: {0}")]
    Bozuk(String),
    #[error("bulunamadı: {0}")]
    Yok(String),
    #[error("{0}")]
    Gecersiz(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Sonuc<T> = Result<T, Hata>;

pub(crate) fn bozuk(m: impl Into<String>) -> Hata {
    Hata::Bozuk(m.into())
}

pub(crate) fn u16_oku(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(o..o + 2)?.try_into().ok()?))
}

pub(crate) fn u32_oku(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}

pub(crate) fn u64_oku(b: &[u8], o: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(o..o + 8)?.try_into().ok()?))
}
