struct ContractDto {
    operation_id: String,
    created_at_ms: u64,
}

struct ContractService<Id, Clock> {
    next_id: Id,
    now: Clock,
}

impl<Id, Clock> ContractService<Id, Clock>
where
    Id: FnMut() -> String,
    Clock: FnMut() -> u64,
{
    fn new(next_id: Id, now: Clock) -> Self {
        Self { next_id, now }
    }

    fn issue(&mut self) -> ContractDto {
        ContractDto {
            operation_id: (self.next_id)(),
            created_at_ms: (self.now)(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ContractService;

    #[test]
    fn contract_test_seam() {
        let mut service =
            ContractService::new(|| "operation-test-1".to_owned(), || 1_700_000_000_000);

        let result = service.issue();

        assert_eq!(result.operation_id, "operation-test-1");
        assert_eq!(result.created_at_ms, 1_700_000_000_000);
    }

    #[test]
    fn contract_test_seam_uses_only_injected_values() {
        let mut ids = ["first", "second"].into_iter();
        let mut times = [0, u64::MAX].into_iter();
        let mut service = ContractService::new(
            move || ids.next().expect("test ID").to_owned(),
            move || times.next().expect("test clock"),
        );

        let first = service.issue();
        let second = service.issue();

        assert_eq!(
            (first.operation_id.as_str(), first.created_at_ms),
            ("first", 0)
        );
        assert_eq!(
            (second.operation_id.as_str(), second.created_at_ms),
            ("second", u64::MAX),
        );
    }
}
